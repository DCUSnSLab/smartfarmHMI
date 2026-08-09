"use client";

/**
 * 농장 배치도 (FR-41) — 구역·통로와 로봇 실시간 위치.
 *
 * 슬롯·스테이션 지점은 아직 확정 전이라 그리지 않는다. 계약과 DB 에는
 * 들어와 있으므로, 확정되면 렌더만 되살리면 된다.
 *
 * 실내 농장이라 위경도를 쓰지 않는다. 배치도·미션 목표·로봇 위치가 모두 엣지의
 * 미터 좌표계(통신 규격 §4.9.1) 하나에 있으므로 변환 없이 그대로 그린다 —
 * 화면 맞춤은 viewBox 가 전부다.
 *
 * 배치도는 서버 DB 에서 오고 브로커 retained 가 아니다. 엣지가 꺼져 있어도
 * 도면은 뜨고, 그 위의 로봇만 사라진다.
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { RobotValue } from "@/lib/monitor";
import { Card, SectionTitle } from "@/components/ui";

interface Zone { id: string; zone_type: string | null; polygon: [number, number][] }
interface Gate { id: string; between: string[]; segment: [number, number][] }
interface Point { id: string; point_type: string; x: number | null; y: number | null }
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
  charging: { fill: "#dcfce7", stroke: "#4ade80", label: "충전" },
  work: { fill: "#dbeafe", stroke: "#60a5fa", label: "작업" },
  headland: { fill: "#fef3c7", stroke: "#fbbf24", label: "선회" },
  corridor: { fill: "#f1f5f9", stroke: "#cbd5e1", label: "통로" },
};

const zoneStyle = (t: string | null) => ZONE_STYLE[t ?? "corridor"] ?? ZONE_STYLE.corridor;

/** ROS 는 y 가 위쪽 양수, SVG 는 아래쪽 양수 — y 만 뒤집는다.
 *  SVG transform 대신 좌표를 직접 변환한다. 그래야 글자가 거울로 뒤집히지 않는다. */
const flipY = (y: number) => -y;

function bounds(layout: Layout, robots: RobotValue[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const z of layout.zones) for (const [x, y] of z.polygon) { xs.push(x); ys.push(flipY(y)); }
  for (const g of layout.gates ?? []) for (const [x, y] of g.segment) { xs.push(x); ys.push(flipY(y)); }
  // 로봇이 도면 밖으로 나가도 잘리지 않게 함께 계산한다.
  for (const r of robots) {
    if (r.pos_x != null && r.pos_y != null) { xs.push(r.pos_x); ys.push(flipY(r.pos_y)); }
  }
  if (!xs.length) return null;
  const pad = 1.5;  // m
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function RobotMarker({ robot, meterPx }: { robot: RobotValue; meterPx: number }) {
  const x = robot.pos_x as number;
  const y = flipY(robot.pos_y as number);
  // 화면 배율과 무관하게 일정 크기로 보이도록 미터 단위 반지름을 역산한다.
  const r = 12 / meterPx;
  const stopped = robot.mission_state === "error";
  const color = stopped ? "#dc2626" : robot.charging ? "#16a34a" : "#2563eb";
  // heading 은 ROS 기준 반시계 양수인데 y 를 뒤집었으므로 회전도 뒤집는다.
  const deg = robot.heading_rad == null ? null : (-robot.heading_rad * 180) / Math.PI;

  return (
    <g>
      <circle cx={x} cy={y} r={r * 1.9} fill={color} opacity={0.15} />
      <circle cx={x} cy={y} r={r} fill={color} stroke="#fff" strokeWidth={r * 0.25} />
      {deg != null && (
        <line
          x1={r * 0.9} y1={0} x2={r * 2.5} y2={0}
          transform={`translate(${x} ${y}) rotate(${deg})`}
          stroke={color}
          strokeWidth={r * 0.5}
          strokeLinecap="round"
        />
      )}
      <text
        x={x} y={y - r * 2.4}
        textAnchor="middle"
        fontSize={13 / meterPx}
        fontWeight={700}
        fill="#0f172a"
      >
        {robot.device_id}
      </text>
    </g>
  );
}

export function FarmMap({ farmId, robots }: { farmId: string; robots: RobotValue[] }) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLayout(null);
    setFailed(false);
    void (async () => {
      try {
        const res = await apiFetch(`/api/farms/${farmId}/layout`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Layout;
        if (alive) setLayout(data);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [farmId]);

  if (failed) {
    return (
      <Card>
        <SectionTitle title="실시간 배치도" />
        <p className="py-8 text-center text-13 text-muted">배치도를 불러오지 못했습니다.</p>
      </Card>
    );
  }
  if (!layout) {
    return (
      <Card>
        <SectionTitle title="실시간 배치도" />
        <div className="h-72 animate-pulse rounded-xl bg-slate-100" />
      </Card>
    );
  }

  const plotted = robots.filter((r) => r.pos_x != null && r.pos_y != null);
  const box = bounds(layout, plotted);

  if (!box) {
    return (
      <Card>
        <SectionTitle title="실시간 배치도" />
        <p className="py-8 text-center text-13 text-muted">
          엣지가 아직 배치도를 보내지 않았습니다.
        </p>
      </Card>
    );
  }

  // viewBox 는 미터 단위, 화면은 고정 높이 — 배율은 세로 기준으로 잡는다.
  const VIEW_H = 420;
  const meterPx = VIEW_H / box.h;
  const usedZoneTypes = [...new Set(layout.zones.map((z) => z.zone_type ?? "corridor"))];

  return (
    <Card>
      <SectionTitle
        title="실시간 배치도"
        sub={`${layout.frame ?? "?"} 좌표계 · m 단위`}
        right={
          <span className="text-12.5 font-semibold text-muted">
            {plotted.length ? `로봇 ${plotted.length}대 표시 중` : "로봇 위치 없음"}
          </span>
        }
      />

      <div className="overflow-x-auto">
        <svg
          viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
          style={{ height: VIEW_H, width: "100%", minWidth: 320 }}
          role="img"
          aria-label={`농장 배치도 — 구역 ${layout.zones.length}개`}
        >
          {layout.zones.map((z) => {
            const s = zoneStyle(z.zone_type);
            return (
              <polygon
                key={z.id}
                points={z.polygon.map(([x, y]) => `${x},${flipY(y)}`).join(" ")}
                fill={s.fill}
                stroke={s.stroke}
                strokeWidth={2 / meterPx}
              />
            );
          })}

          {(layout.gates ?? []).map((g) => {
            if (g.segment.length < 2) return null;
            const [[x1, y1], [x2, y2]] = g.segment;
            return (
              <line
                key={g.id}
                x1={x1} y1={flipY(y1)} x2={x2} y2={flipY(y2)}
                stroke="#94a3b8"
                strokeWidth={3 / meterPx}
                strokeDasharray={`${5 / meterPx} ${4 / meterPx}`}
              />
            );
          })}

          {plotted.map((r) => (
            <RobotMarker key={r.device_id} robot={r} meterPx={meterPx} />
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-12.5 text-muted">
        {usedZoneTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ background: zoneStyle(t).fill, borderColor: zoneStyle(t).stroke }}
            />
            {zoneStyle(t).label}
          </span>
        ))}
        {(layout.gates ?? []).length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-slate-400" />
            통로
          </span>
        )}
        {layout.source === "edge" && <span className="ml-auto">엣지 자기기술</span>}
      </div>
    </Card>
  );
}
