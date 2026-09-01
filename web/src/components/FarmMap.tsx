"use client";

/**
 * 농장 배치도 (FR-41) — 구역·통로와 그 위의 장치.
 *
 * 실내 농장이라 위경도를 쓰지 않는다. 배치도·미션 목표·로봇 위치가 모두 엣지의
 * 미터 좌표계(통신 규격 §4.9.1) 하나에 있으므로 변환 없이 그대로 그린다 —
 * 화면 맞춤은 viewBox 가 전부다.
 *
 * 배치도는 서버 DB 에서 오고 브로커 retained 가 아니다. 엣지가 꺼져 있어도
 * 도면은 뜨고, 그 위의 장치만 사라진다.
 *
 * 장치 표식은 두 갈래로 놓인다.
 *   로봇   — 실시간 위치 (robot_status.position)
 *   그 외  — 배치도 지점 (layout.points 의 device_id)
 *
 * 엣지가 배치도를 보내기 전에는 **예시 배치**를 그린다 (demoLayout). 배치와 상호작용을
 * 미리 볼 수 있게 하는 자리끼우개이고, 화면에 「예시 배치」라고 못 박아 붙인다 —
 * 실제 좌표가 도착하면 통째로 교체된다.
 *
 * 종류는 **실루엣**(크기·비율·글리프)으로, 상태는 **색**으로 나눈다. 둘을 한 축에
 * 몰면 「빨간 센서」와 「빨간 탱크」가 같은 도형이 되어 무엇이 고장인지 안 읽힌다.
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RobotValue } from "@/lib/monitor";
import { Card, SectionTitle } from "@/components/ui";
import { SEV_STYLE, sevHex } from "@/lib/severity";
import { KIND_LABEL, KINDS, type DeviceKind, type DeviceStatus } from "@/lib/deviceStatus";

interface Zone { id: string; zone_type: string | null; polygon: [number, number][] }
interface Gate { id: string; between: string[]; segment: [number, number][] }
interface Point {
  id: string;
  point_type: string;
  x: number | null;
  y: number | null;
  /** 이 자리에 놓인 장치 — 표식을 붙이는 유일한 근거 (§4.9.1) */
  ref_device_id?: string | null;
}
interface Layout {
  frame: string | null;
  /** 존은 주행 공간, 게이트는 존 사이 통로, 지점은 작업 대상 — 서로 다른 개념이다. */
  zones: Zone[];
  gates: Gate[];
  points: Point[];
  source: string | null;
  updated_at: string | null;
}

const ZONE_STYLE: Record<string, { fill: string; stroke: string; label: string }> = {
  charging: { fill: "#E7F7EF", stroke: "#7DD3A8", label: "충전" },
  station: { fill: "#E7F7EF", stroke: "#7DD3A8", label: "작업 스테이션" },
  work: { fill: "#DBEAFE", stroke: "#60A5FA", label: "작업" },
  headland: { fill: "#FEF3C7", stroke: "#FBBF24", label: "선회" },
  storage: { fill: "#FEF3C7", stroke: "#FBBF24", label: "보관·충전" },
  corridor: { fill: "#F1F5F9", stroke: "#CBD5E1", label: "통로" },
};

const zoneStyle = (t: string | null) => ZONE_STYLE[t ?? "corridor"] ?? ZONE_STYLE.corridor;

/**
 * 표식 실루엣 — 종류마다 크기·비율·글리프가 다르다.
 * 픽셀 고정이다. 도면 배율에 따라 표식까지 커지면 넓은 농장에서는 점이 사라지고
 * 좁은 농장에서는 표식이 구역을 덮는다 — 표식은 「무엇이 어디에」를 가리키는
 * 기호이지 실제 크기가 아니다.
 */
const SHAPE: Record<DeviceKind, { w: number; h: number; radius: string; glyph: string }> = {
  robot: {
    w: 26, h: 26, radius: "9px",
    glyph: "M6.5 9.5h11v8h-11z M12 4.5v5 M4 13.5h2.5 M17.5 13.5h2.5 M9.5 13h.01 M14.5 13h.01",
  },
  sensor: { w: 13, h: 13, radius: "50%", glyph: "" },
  tank: {
    w: 17, h: 23, radius: "8px 8px 5px 5px",
    glyph: "M6 10.5h12 M6 15.5c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0",
  },
  station: {
    w: 25, h: 19, radius: "4px",
    glyph: "M4.5 10h15 M8 10v7.5 M16 10v7.5 M12 4.5V10",
  },
};

/** ROS 는 y 가 위쪽 양수, SVG 는 아래쪽 양수 — y 만 뒤집는다.
 *  SVG transform 대신 좌표를 직접 변환한다. 그래야 글자가 거울로 뒤집히지 않는다. */
const flipY = (y: number) => -y;

interface Marker {
  device: DeviceStatus;
  /** 그림 상자 안의 상대 위치 (%) — HTML 표식을 얹기 위해 미터에서 환산한다 */
  left: number;
  top: number;
  headingDeg: number | null;
}

/**
 * 그림 상자의 가로세로비 — **고정**이다 (디자인의 744×300).
 *
 * 도면 크기에서 비율을 뽑으면 카드 높이가 도면에 따라 달라지고, 그 높이가 로봇
 * 위치처럼 매 초 바뀌는 값에 걸려 있으면 카드가 숨을 쉰다 — 같은 행의 하드웨어
 * 카드까지 함께 늘어난다. 비율을 못 박고, 남는 쪽을 도면 여백으로 채운다.
 */
const VIEW_ASPECT = 744 / 300;

/**
 * 농장별 도면 기억 — 배치도는 서버 DB 에서 오고 거의 바뀌지 않는다.
 *
 * 농장을 옮길 때마다 회색 상자를 한 번씩 보여 주면 되돌아왔을 때도 또 보여 준다.
 * 이미 받아 둔 것을 먼저 그리고 뒤에서 다시 받아 갱신한다 — 받는 동안 화면이 비지
 * 않는다. 모듈 수준이라 화면을 떠나도 남는다.
 */
const layoutCache = new Map<string, Layout>();

// ─────────────────────────────────────────────────────────────────────────────
// 예시 배치
// ─────────────────────────────────────────────────────────────────────────────

/** 자리를 고르게 나눈다 — 하나면 가운데, 여럿이면 양 끝을 포함해 등간격 */
function spread(n: number, from: number, to: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(from + to) / 2];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/**
 * 예시 배치 — 엣지가 배치도를 보내기 전의 자리끼우개.
 *
 * **좌표는 꾸민 것이다.** 실제 위치가 아니고, 종류별로 「어디쯤에 몇 개」만 흉내 낸다.
 * 그래서 화면에 「예시 배치」를 붙인다 — 이 그림을 보고 현장을 찾아가면 안 된다.
 *
 * 대수는 농장마다 다르므로 자리를 나눠 갖는다. 탱크가 둘이면 둘이 넓게, 다섯이면
 * 다섯이 좁게 들어간다 — 성주 농장의 개수를 박아 두면 다른 농장에서 어긋난다.
 *
 * 로봇도 여기서는 꾸민 자리에 둔다. 실제 좌표는 엣지의 좌표계에 있고 이 예시 격자와
 * 아무 관계가 없어, 그대로 얹으면 도면 밖이나 엉뚱한 구역에 찍힌다.
 */
function demoLayout(devices: DeviceStatus[]): Layout {
  // 구역 전체(37×15m)를 화면 비율(≈2.48)에 맞춰 잡는다. 내용 비율이 화면과 어긋나면
  // 짧은 쪽에 빈 띠가 남는다 — bounds 가 비율을 맞추려 그쪽을 늘리기 때문이다.
  // 미터 수를 넉넉히 두는 것도 같은 이유다. 여백은 미터 고정값이라, 도면이 작으면
  // 그 여백이 차지하는 비율이 커져 그림만 쪼그라든다.
  const zones: Zone[] = [
    { id: "재배 랙 A", zone_type: "work", polygon: rect(1.0, 18.0, 15.0, 20.0) },
    { id: "재배 랙 B", zone_type: "work", polygon: rect(1.0, 2.2, 3.4, 17.8) },
    { id: "재배 랙 C", zone_type: "work", polygon: rect(7.3, 2.2, 9.7, 17.8) },
    { id: "재배 랙 D", zone_type: "work", polygon: rect(12.6, 2.2, 15.0, 17.8) },
    { id: "재배 랙 E", zone_type: "work", polygon: rect(1.0, 0.0, 15.0, 2.0) },
    { id: "워크스테이션", zone_type: "station", polygon: rect(15.3, 10.5, 18.2, 12.8) },
  ];

  // 점선 통로 — 위·아래 가로 랙과 세로 랙의 접점, D 랙과 워크스테이션의 접점.
  const gates: Gate[] = [
    { id: "상단 통로 B", between: ["재배 랙 A", "재배 랙 B"], segment: [[1.0, 17.9], [3.4, 17.9]] },
    { id: "상단 통로 C", between: ["재배 랙 A", "재배 랙 C"], segment: [[7.3, 17.9], [9.7, 17.9]] },
    { id: "상단 통로 D", between: ["재배 랙 A", "재배 랙 D"], segment: [[12.6, 17.9], [15.0, 17.9]] },
    { id: "하단 통로 B", between: ["재배 랙 E", "재배 랙 B"], segment: [[1.0, 2.1], [3.4, 2.1]] },
    { id: "하단 통로 C", between: ["재배 랙 E", "재배 랙 C"], segment: [[7.3, 2.1], [9.7, 2.1]] },
    { id: "하단 통로 D", between: ["재배 랙 E", "재배 랙 D"], segment: [[12.6, 2.1], [15.0, 2.1]] },
    { id: "워크스테이션 통로", between: ["재배 랙 D", "워크스테이션"], segment: [[15.15, 10.5], [15.15, 12.8]] },
  ];

  const of = (kind: DeviceKind) => devices.filter((d) => d.kind === kind);
  // 탱크 구역을 제외했으므로 수위 센서를 포함한 모든 센서를 랙에 배치한다.
  const sensors = of("sensor");

  const points: Point[] = [];
  const put = (d: DeviceStatus, x: number, y: number, type: string) => {
    points.push({ id: `demo-${d.id}`, point_type: type, x, y, ref_device_id: d.id });
  };

  // 센서는 다섯 랙에 고르게 나눈 뒤 각 랙의 중심선을 따라 등간격으로 배치한다.
  // 센서가 늘어나도 처음 자리로 되돌아가지 않으므로 표식이 완전히 겹치지 않는다.
  const rackLines = [
    { axis: "x", at: 19.0, from: 3.0, to: 13.0 }, // A 가로 중심선
    { axis: "y", at: 2.2, from: 5.0, to: 15.0 },  // B 세로 중심선
    { axis: "y", at: 8.5, from: 5.0, to: 15.0 },  // C 세로 중심선
    { axis: "y", at: 13.8, from: 5.0, to: 15.0 }, // D 세로 중심선
    { axis: "x", at: 1.0, from: 3.0, to: 13.0 },  // E 가로 중심선
  ] as const;
  const sensorsByRack = rackLines.map(() => [] as DeviceStatus[]);
  sensors.forEach((d, i) => sensorsByRack[i % rackLines.length].push(d));
  sensorsByRack.forEach((rackSensors, rackIndex) => {
    const line = rackLines[rackIndex];
    spread(rackSensors.length, line.from, line.to).forEach((v, i) => {
      put(rackSensors[i], line.axis === "x" ? v : line.at, line.axis === "y" ? v : line.at, "sensor");
    });
  });

  // 워크스테이션 — 현재 구역 안의 가로 중심선에 한 줄로 배치한다.
  const stations = of("station");
  spread(stations.length, 15.8, 17.7).forEach((x, i) => put(stations[i], x, 11.65, "station"));

  // 로봇 — 하단 점선 통로의 오른쪽부터 배치한다 (예시이므로 주행 중을 뜻하지 않는다).
  const robots = of("robot");
  const robotSlots = [
    { x: 13.8, y: 2.1 },
    { x: 8.5, y: 2.1 },
    { x: 2.2, y: 2.1 },
  ];
  robots.forEach((d, i) => {
    const slot = robotSlots[i % robotSlots.length];
    put(d, slot.x, slot.y, "robot");
  });

  return { frame: null, zones, gates, points, source: "placeholder", updated_at: null };
}


// ─────────────────────────────────────────────────────────────────────────────

/**
 * 도면이 담길 좌표 창. 구역·통로가 창을 정하고 장치는 창을 넓히기만 한다
 * (도면 밖으로 나간 로봇이 잘리지 않게).
 *
 * 바깥쪽으로 조금 굴린다 — 로봇이 몇 cm 움직일 때마다 창이 따라 움직이면 도면
 * 전체가 잘게 떠는 것처럼 보인다. 사람이 볼 것은 로봇의 이동이지 도면의 이동이 아니다.
 * 굴림과 여백은 둘 다 그림을 줄이는 쪽으로만 작용하므로, 떨림을 없앨 만큼만 둔다
 * (1m 로 굴리면 작은 도면에서 높이의 삼분의 일이 빈 공간이 된다).
 */
function bounds(zones: Zone[], gates: Gate[], pts: { x: number; y: number }[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const z of zones) for (const [x, y] of z.polygon) { xs.push(x); ys.push(flipY(y)); }
  for (const g of gates) for (const [x, y] of g.segment) { xs.push(x); ys.push(flipY(y)); }
  // 구역이나 통로가 있으면 그것만으로 창을 고정한다. 실시간 로봇 좌표를 창 계산에
  // 넣으면 로봇이 움직일 때마다 랙 전체가 확대·축소되거나 좌우로 흔들린다.
  // 도면이 완전히 비었을 때만 장치 위치로 창을 잡는다.
  if (!xs.length) {
    for (const p of pts) { xs.push(p.x); ys.push(flipY(p.y)); }
  }
  if (!xs.length) return null;
  // 여백은 표식이 카드 경계에 걸리지 않을 만큼 (표식 반지름 ≈ 13px ≈ 0.5m)
  const pad = 0.5;   // m
  const step = 0.25; // m
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  const minX = down(Math.min(...xs) - pad);
  const maxX = up(Math.max(...xs) + pad);
  const minY = down(Math.min(...ys) - pad);
  const maxY = up(Math.max(...ys) + pad);

  // 화면 상자 비율에 맞춰 짧은 쪽을 넓힌다. preserveAspectRatio 에 맡기면 SVG 가
  // 안에서 여백을 만들어, 그 위에 %로 얹은 HTML 표식이 그림과 어긋난다.
  let w = maxX - minX, h = maxY - minY;
  if (w / h < VIEW_ASPECT) w = h * VIEW_ASPECT;
  else h = w / VIEW_ASPECT;
  return {
    minX: minX - (w - (maxX - minX)) / 2,
    minY: minY - (h - (maxY - minY)) / 2,
    w, h,
  };
}

/**
 * 겹쳐 띄우는 설명 — 축을 한 줄씩 적는다. 색만으로는 어느 축이 나쁜지 모른다.
 *
 * ── 폭은 고정이다 (TIP_W). ──
 * 내용에 맞춰 늘었다 줄었다 하면 표식을 옮겨 다닐 때마다 상자 크기가 튀어 읽는
 * 자리가 매번 달라진다. rem 으로 잡아 큰글씨 배율(--sf-scale, 최대 1.28)과 함께
 * 늘어나므로, 글자가 커져도 여유가 그대로 유지된다 — px 로 박으면 큰글씨에서만
 * 넘친다.
 *
 * 넘칠 때는 **줄바꿈**으로 받는다. 말줄임(…)은 쓰지 않는다 — 로봇 오류 문구처럼
 * 길이를 미리 알 수 없는 값이 있고, 그게 잘리면 정작 무엇이 틀어졌는지 못 읽는다.
 * 폭은 실제 문구를 재서 가장 긴 것에 맞췄다 — 「1240ppm 적정 초과」(축 문구 칸의 91%)와
 * 「WS1 급수 스테이션」(이름 칸의 72%). 더 줄이면 이 둘이 두 줄로 접힌다.
 *
 * 높이는 고정하지 않는다. 축 수는 장치 종류마다 다르고(워크스테이션 1, 센서 2,
 * 로봇 2~3) 그건 뜻이 있는 차이다 — 맞추려고 빈 줄을 넣으면 없는 축이 있는 것처럼 보인다.
 *
 * 자리는 표식 옆 → 좁은 화면에서는 도면 아래. 절대 위치 요소의 폭은 「기준 상자의
 * 그 변까지 남은 공간」으로 정해지므로, 오른쪽 끝 표식에 붙이면 남은 몇 %만 폭으로
 * 받는다. 그래서 왼쪽으로 열 때는 transform 이 아니라 **right 로 붙인다** —
 * transform 은 그린 뒤에 옮기는 것이라 폭 계산을 바꾸지 못한다.
 */
const TIP_W = "w-48";                        // 12rem — 가장 긴 축 문구 + 여유 9%
const TIP_CAP = "max-w-[calc(100%-1.5rem)]";  // 어떤 배율에서도 카드를 넘지 않는다

function MarkerTip({ m, flip }: { m: Marker; flip: boolean }) {
  const d = m.device;
  return (
    <div
      // 좁은 화면(md 미만)에서는 표식에 붙이지 않고 도면 아래에 깐다. 붙일 자리가
      // 폭보다 좁아 어느 쪽으로 열어도 카드를 넘어가기 때문이다.
      className={
        "pointer-events-none absolute inset-x-3 bottom-3 z-20 rounded-xl bg-body px-3 py-2.5 shadow-lg " +
        `md:inset-x-auto md:bottom-auto md:-translate-y-3.5 ${TIP_W} ${TIP_CAP} ` +
        "md:left-[var(--tip-l)] md:right-[var(--tip-r)] md:top-[var(--tip-t)]"
      }
      style={{
        "--tip-l": flip ? "auto" : `calc(${m.left.toFixed(3)}% + 12px)`,
        "--tip-r": flip ? `calc(${(100 - m.left).toFixed(3)}% + 12px)` : "auto",
        "--tip-t": `${m.top}%`,
      } as React.CSSProperties}
    >
      <div className="flex items-start gap-1.5">
        <span
          className="mt-1 h-2 w-2 flex-none rounded-full"
          style={{ background: sevHex(d.sev) }}
        />
        <span className="min-w-0 break-words text-12.5 font-extrabold text-white">{d.name}</span>
      </div>
      <div className="mt-0.5 text-11 font-semibold text-gray-400">{KIND_LABEL[d.kind]}</div>
      <div className="mt-1.5 flex flex-col gap-1 border-t border-gray-600 pt-1.5">
        {d.axes.map((a) => (
          <div key={a.axis} className="flex items-start gap-1.5">
            {/* 축 이름 칸은 줄을 맞추되 글자가 길어지면 늘어난다 (큰글씨에서 접히지 않게).
                가장 긴 「배터리」에 맞춘 폭이다 — 더 넓히면 값에 쓸 자리를 빼앗는다 */}
            <span className="min-w-[2.125rem] flex-none text-10.5 font-bold text-gray-400">{a.axis}</span>
            <span
              className="mt-1 h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: sevHex(a.sev) }}
            />
            <span
              className="min-w-0 flex-1 break-words text-11.5 font-extrabold"
              style={{ color: a.sev === "ok" || a.sev === "busy" ? "#fff" : sevHex(a.sev) }}
            >
              {a.text}
            </span>
          </div>
        ))}
      </div>
      {/* 탱크만 — 숫자와 함께 잔량을 그림으로 (「24%」가 적정인지 바닥인지 한눈에) */}
      {d.levelPct != null && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-gray-600 pt-1.5">
          <span className="relative h-5 w-2.5 flex-none overflow-hidden rounded-[3px] border border-gray-500">
            <span
              className="absolute inset-x-0 bottom-0"
              style={{ background: sevHex(d.sev), height: `${Math.max(0, Math.min(100, d.levelPct))}%` }}
            />
          </span>
          <span className="text-12 font-extrabold text-white">잔량 {Math.round(d.levelPct)}%</span>
        </div>
      )}
    </div>
  );
}

/**
 * 범례 — 종류는 실루엣, 상태는 색. 도면 데이터와 무관한 고정 내용이라 도면을 받는
 * 동안에도 그대로 둔다. 로딩 중에만 감추면 그만큼 카드가 낮아져 화면 전체가 밀린다.
 */
function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-11.5 font-semibold text-muted">
      {KINDS.map((kind) => {
        const sh = SHAPE[kind];
        return (
          <span key={kind} className="flex items-center gap-1.5">
            <span
              className="inline-flex flex-none items-center justify-center bg-[#4E5968]"
              style={{ width: sh.w * 0.92, height: sh.h * 0.92, borderRadius: sh.radius }}
            >
              {sh.glyph && (
                <svg viewBox="0 0 24 24" className="h-[76%] w-[76%]" aria-hidden="true">
                  <path
                    d={sh.glyph} fill="none" stroke="#fff" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
            {KIND_LABEL[kind]}
          </span>
        );
      })}
      <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {["ok", "busy", "idle", "caution", "warning"].map((sev) => (
          <span key={sev} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: sevHex(sev) }} />
            {SEV_STYLE[sev].label}
          </span>
        ))}
      </span>
    </div>
  );
}

export function FarmMap({
  farmId, robots, statuses, active, onHover, onSelect,
}: {
  farmId: string;
  robots: RobotValue[];
  /** device_id → 상태. 배치도·하드웨어·설비 현황이 같은 판정을 쓴다 */
  statuses: Record<string, DeviceStatus>;
  /** 지금 지목된 장치 — 하드웨어 카드와 공유한다 */
  active: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  // 기억해 둔 도면이 있으면 그것으로 시작한다 — 첫 프레임부터 그릴 것이 있다
  const [layout, setLayout] = useState<Layout | null>(() => layoutCache.get(farmId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // 농장이 바뀌면 이전 농장 도면을 버린다. 기억해 둔 것이 있으면 곧바로 그것으로
    // 갈아탄다 — 비워 두면 회색 상자가 한 번 스친다.
    setLayout(layoutCache.get(farmId) ?? null);
    setFailed(false);
    void (async () => {
      try {
        const res = await apiFetch(`/api/farms/${farmId}/layout`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Layout;
        layoutCache.set(farmId, data);
        if (alive) setLayout(data);
      } catch {
        // 기억해 둔 도면이 있으면 계속 그린다 — 한 번의 실패로 지울 이유가 없다
        if (alive && !layoutCache.has(farmId)) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [farmId]);

  const devices = Object.values(statuses);
  // 구역이 하나도 없으면 아직 배치도를 못 받은 것이다 — 예시 배치로 자리를 채운다.
  // 구역이 오면 지점·좌표까지 통째로 실제 것으로 바뀐다 (일부만 섞으면 어느 쪽이
  // 실제인지 화면에서 구분되지 않는다).
  const demo = layout != null && layout.zones.length === 0 ? demoLayout(devices) : null;
  const shown = demo ?? layout;

  /**
   * 카드 틀 — 제목 · 그림 자리 · 범례. **어떤 상태에서도 같은 높이다.**
   *
   * 예전에는 도면을 받는 동안 다른 크기의 회색 상자를 그렸다. 그 카드가 줄었다
   * 늘어나면 같은 줄의 하드웨어 카드와 아래 줄 전체가 위아래로 밀려, 카드가
   * 사라졌다 나타나는 것처럼 보인다. 그림 자리를 미리 잡아 두면 안에 무엇이
   * 들어가든 바깥이 흔들리지 않는다.
   *
   * 범례는 도면과 무관한 고정 내용이라 받는 동안에도 그대로 둔다 (그래야 높이가 같다).
   */
  const frame = (inner: React.ReactNode, right?: React.ReactNode) => (
    <Card>
      <SectionTitle
        title="실시간 배치도"
        sub={demo ? "예시 배치 · 로봇 위치 실시간" : `${layout?.frame ?? "?"} 좌표계 · m 단위`}
        right={right}
      />
      <div className="relative w-full" style={{ aspectRatio: VIEW_ASPECT }}>{inner}</div>
      <Legend />
    </Card>
  );

  const notice = (text: string) => (
    <p className="absolute inset-0 flex items-center justify-center text-13 text-muted">{text}</p>
  );

  if (failed) return frame(notice("배치도를 불러오지 못했습니다."));
  if (!shown) return frame(<div className="absolute inset-0 animate-pulse rounded-xl bg-surface" />);

  // 실제·예시 배치 모두 로봇이 보내는 실시간 위치를 우선 사용한다.
  // 위치가 아직 없는 로봇만 layout.points 또는 demoLayout 의 임시 지점으로 대체한다.
  const liveRobots = robots
    .filter((r) => r.pos_x != null && r.pos_y != null && statuses[r.device_id])
    .map((r) => ({
      device: statuses[r.device_id], x: r.pos_x as number, y: r.pos_y as number,
      // heading 은 ROS 기준 반시계 양수인데 y 를 뒤집었으므로 회전도 뒤집는다.
      headingDeg: r.heading_rad == null ? null : (-r.heading_rad * 180) / Math.PI,
    }));
  const liveRobotIds = new Set(liveRobots.map((p) => p.device.id));
  const placed = liveRobots.concat(
    (shown.points ?? [])
      .filter((p) => p.x != null && p.y != null)
      .flatMap((p) => {
        const id = p.ref_device_id ?? null;
        const device = id ? statuses[id] : undefined;
        if (device?.kind === "robot" && liveRobotIds.has(device.id)) return [];
        return device ? [{ device, x: p.x as number, y: p.y as number, headingDeg: null }] : [];
      }),
  );

  const box = bounds(shown.zones, shown.gates ?? [], placed);

  if (!box) return frame(notice("엣지가 아직 배치도를 보내지 않았습니다."));

  const markerCandidates: Marker[] = placed.map((p) => ({
    device: p.device,
    left: ((p.x - box.minX) / box.w) * 100,
    top: ((flipY(p.y) - box.minY) / box.h) * 100,
    headingDeg: p.headingDeg,
  }));
  // 로봇은 제목과 범례 사이의 실제 배치도 영역 안에서만 표시한다. % 좌표를
  // 사용하므로 브라우저 폭에 따라 도면의 픽셀 크기가 바뀌어도 같은 기준이 유지된다.
  const markers = markerCandidates.filter((m) =>
    m.device.kind !== "robot" ||
    (m.left >= 0 && m.left <= 100 && m.top >= 0 && m.top <= 100),
  );
  const hit = markers.find((m) => m.device.id === active) ?? null;
  // 도면 오른쪽 절반의 표식은 설명을 왼쪽으로 뒤집는다 (안 그러면 카드를 넘어간다).
  // 기준이 절반인 이유: 설명 폭이 고정이므로, 가장 좁은 「옆에 붙이는」 도면 폭에서
  // 양쪽 어디로 열어도 들어가는 경계가 딱 절반이다.
  const tipFlip = hit != null && hit.left > 50;
  const labelSize = box.h / 26;

  // 로딩·오류 상태와 **같은 틀**을 쓴다 — 카드 높이가 상태에 따라 달라지지 않는다
  return frame(
    <>
      {/* 도면과 표식만 배치도 영역에서 자른다. 상세 정보는 바깥 레이어에 두어
          가장자리 센서를 선택해도 내용이 잘리지 않게 한다. */}
      <div className="absolute inset-0 overflow-hidden">
      <svg
          viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`농장 배치도 — 구역 ${shown.zones.length}개, 장치 ${markers.length}개${
            demo ? " (예시 배치)" : ""
          }`}
        >
          {shown.zones.map((z) => {
            const s = zoneStyle(z.zone_type);
            const xs = z.polygon.map(([x]) => x);
            const ys = z.polygon.map(([, y]) => flipY(y));
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const rackName = z.id.match(/^재배 랙\s+(.+)$/);
            const splitRackName = rackName != null && maxX - minX < labelSize * 5;
            const textX = splitRackName ? (minX + maxX) / 2 : minX + labelSize * 0.5;
            const textY = minY + labelSize * (splitRackName ? 0.9 : 1.2);
            return (
              <g key={z.id}>
                <polygon
                  points={z.polygon.map(([x, y]) => `${x},${flipY(y)}`).join(" ")}
                  fill={s.fill} stroke={s.stroke} strokeWidth={box.h / 200}
                />
                {/* 구역 이름을 도면 안에 적는다 — 범례로 빼면 색을 눈으로 맞춰야 한다 */}
                {xs.length > 0 && (
                  <text
                    x={textX}
                    y={textY}
                    textAnchor={splitRackName ? "middle" : "start"}
                    fontSize={splitRackName ? labelSize * 0.72 : labelSize}
                    fontWeight={700} fill={s.stroke}
                  >
                    {splitRackName ? (
                      <>
                        <tspan x={textX}>재배 랙</tspan>
                        <tspan x={textX} dy={labelSize * 0.85}>{rackName[1]}</tspan>
                      </>
                    ) : z.id}
                  </text>
                )}
              </g>
            );
          })}

          {(shown.gates ?? []).map((g) => {
            if (g.segment.length < 2) return null;
            const [[x1, y1], [x2, y2]] = g.segment;
            return (
              <line
                key={g.id}
                x1={x1} y1={flipY(y1)} x2={x2} y2={flipY(y2)}
                stroke="#94a3b8" strokeWidth={box.h / 140}
                strokeDasharray={`${box.h / 84} ${box.h / 105}`}
              />
            );
          })}

          {/* 로봇 방향 — 표식 아래에 깔아 진행 방향만 남긴다 */}
          {markers.map((m) =>
            m.headingDeg == null ? null : (
              <line
                key={`h-${m.device.id}`}
                x1={box.h / 22} y1={0} x2={box.h / 9} y2={0}
                transform={`translate(${box.minX + (m.left / 100) * box.w} ${
                  box.minY + (m.top / 100) * box.h
                }) rotate(${m.headingDeg})`}
                stroke={sevHex(m.device.sev)} strokeWidth={box.h / 90} strokeLinecap="round"
              />
            ),
          )}
        </svg>

        {markers.map((m) => {
          const sh = SHAPE[m.device.kind];
          const on = m.device.id === active;
          return (
            <span
              key={m.device.id}
              role="button" tabIndex={0}
              aria-label={`${m.device.name} · ${m.device.label}`}
              onMouseEnter={() => onHover(m.device.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(m.device.id)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(m.device.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(m.device.id); }
              }}
              data-device-pick=""
              className="absolute box-border flex cursor-pointer items-center justify-center transition-[transform,opacity] duration-100"
              style={{
                left: `${m.left}%`, top: `${m.top}%`,
                width: sh.w, height: sh.h, borderRadius: sh.radius,
                background: sevHex(m.device.sev),
                boxShadow: on
                  ? "0 0 0 2px #fff, 0 0 0 4.5px rgba(25,31,40,.85), 0 3px 9px rgba(0,0,0,.2)"
                  : "0 0 0 2px #fff, 0 1px 3px rgba(0,0,0,.18)",
                transform: `translate(-50%,-50%) scale(${on ? 1.4 : 1})`,
                opacity: active == null || on ? 1 : 0.28,
                zIndex: on ? 6 : 3,
              }}
            >
              {sh.glyph && (
                <svg viewBox="0 0 24 24" className="h-[76%] w-[76%]" aria-hidden="true">
                  <path
                    d={sh.glyph} fill="none" stroke="#fff" strokeWidth={2}
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          );
        })}
      </div>

      {hit && <MarkerTip m={hit} flip={tipFlip} />}
    </>,
    <span className="flex items-center gap-2">
      {demo && (
        <span
          title="엣지가 배치도(§4.9.1)를 보내면 실제 좌표로 바뀝니다"
          className="rounded-lg bg-status-caution/10 px-2 py-0.5 text-11 font-extrabold text-status-cautionDark"
        >
          예시 배치
        </span>
      )}
      <span className="text-12.5 font-semibold text-muted">
        {markers.length ? `장치 ${markers.length}개 표시 중` : "표시할 장치 위치 없음"}
      </span>
    </span>,
  );
}
