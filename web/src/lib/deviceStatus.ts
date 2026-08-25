"use client";

/**
 * 장치 상태 판정 — 상태 화면의 설비 현황·배치도·하드웨어·상태 요약이 **같은 근거**를
 * 쓰도록 여기 한 곳에서 만든다.
 *
 * 핵심은 장치마다 **축이 여럿**이라는 것이다.
 *
 *   로봇        수신(FR-37) · 배터리 · 오류
 *   센서        수신(FR-37) · 값(알림 규칙의 상·하한)
 *   탱크        잔량        — 발행 주체가 아니라 통신 축이 없다 (ui.tankBadge 주석)
 *   워크스테이션 작업 상태   — FR-37 대상이 아니라 통신 축이 없다 (ui.STATION_STATE 주석)
 *
 * 표식 색은 그 중 **가장 나쁜 축**을 따른다. 축을 하나로 뭉개면 「통신은 정상인데
 * CO₂ 가 상한을 넘은」 센서가 초록으로 보이거나, 반대로 값은 적정인데 수신이 끊긴
 * 센서가 정상으로 보인다 — 고치는 사람도 조치도 다른 상태다.
 *
 * 판정 기준은 새로 만들지 않는다. 통신은 monitor.deviceLiveness(FR-37 임계),
 * 적정 범위는 설정의 알림 규칙, 잔량은 ui.tankBadge — 화면마다 다시 적으면 갈라진다.
 */

import {
  CONN_STYLE, rangeSide, SENSOR_META, SEV_RANK, STATION_STATE, TANK_LABEL, tankBadge,
} from "@/lib/severity";
import {
  deviceLiveness, sensorLiveness, timeAgo,
  type ConnState, type RobotValue, type SensorValue,
} from "@/lib/monitor";
import type { FarmSnapshot, StationInfo, TankInfo } from "@/lib/fleet";

export type DeviceKind = "robot" | "sensor" | "tank" | "station";

/** 그룹 순서 — 화면마다 같은 순서로 나와야 한다 (고리·타일·범례) */
export const KINDS: DeviceKind[] = ["robot", "sensor", "tank", "station"];

export const KIND_LABEL: Record<DeviceKind, string> = {
  robot: "로봇", sensor: "센서", tank: "탱크", station: "워크스테이션",
};

/** 알림 규칙의 상·하한 (설정 화면에서 사용자가 정한 값) */
export type Ranges = Record<string, { min: number | null; max: number | null }>;

export interface DeviceAxis {
  /** 「수신」·「값」·「잔량」·「작업」 — 무엇을 보고 판단한 건지 */
  axis: string;
  sev: string;
  text: string;
}

export interface DeviceStatus {
  id: string;
  kind: DeviceKind;
  name: string;
  /** 타일에 들어가는 짧은 이름 (전체 이름은 title 로 남긴다) */
  short: string;
  /** 가장 나쁜 축의 등급 */
  sev: string;
  /** 가장 나쁜 축의 문구 (모두 정상이면 「정상」) */
  label: string;
  /** 대표 등급을 정한 축의 이름 — 사유를 「원인」과 「결과」로 가르는 데 쓴다 */
  worstAxis: string;
  axes: DeviceAxis[];
  /** 탱크만 — 겹쳐 띄우는 설명의 잔량 막대에 쓴다 */
  levelPct?: number | null;
}

export interface DeviceGroup {
  kind: DeviceKind;
  label: string;
  items: DeviceStatus[];
  count: number;
  /** 「7/9」 — 이상 없는 대수 */
  ratio: string;
  /** 「모두 정상」 · 「경고 1 · 주의 1」 */
  summary: string;
  /** summary 를 칠할 등급 */
  tone: string;
}

/** 상태를 만드는 데 필요한 입력 — 실시간(WS) 값과 스냅샷 값 어느 쪽이든 받는다 */
export interface StatusInput {
  sensors: SensorValue[];
  /** name 은 스냅샷 연결 레코드에만 있다 (WS 스트림은 값만 보낸다) */
  conns: Record<string, ConnState & { name?: string | null }>;
  robots: RobotValue[];
  /**
   * 대장에 등록된 로봇 id. 로봇 목록은 값(robot_status)에서 오므로, 등록만 되고
   * 한 번도 발행하지 않은 로봇이 여기 없으면 화면에서 아예 사라진다 — 「없는 로봇」과
   * 「말이 없는 로봇」은 다른 상태고, 후자는 사람이 확인해야 한다.
   */
  robotIds?: string[];
  tanks: TankInfo[];
  stations: (StationInfo & { name?: string | null })[];
  ranges: Ranges;
  /** device_id → 표시 이름. 로봇 이름은 값 스트림에 없어 여기서 받는다 */
  names?: Record<string, string>;
  /** 센서를 묶어 발행하는 생육기 (장비 등록의 parent_device_id) */
  parents?: Record<string, string | null>;
}

/**
 * 짧은 이름 — 타일 한 칸(3열)에 들어가야 한다. 종류를 나타내는 꼬리말은 이미
 * 그룹 제목이 말하고 있으므로 떼어 낸다 (「온도센서 A」 → 「온도 A」).
 */
const SHORT_RULES: [RegExp, string][] = [
  [/^WS\d+\s*/, ""],            // WS1 급수 스테이션 → 급수 스테이션
  [/\s*탱크\s*수위계$/, " 수위"],  // 양액 탱크 수위계 → 양액 수위
  [/\s*수위계$/, " 수위"],
  [/\s*스테이션$/, " ST"],        // 방제 스테이션 → 방제 ST
  [/\s*탱크$/, ""],              // 양액 탱크 → 양액
  [/센서\s*/, " "],              // 온도센서 A → 온도 A
  [/로봇$/, ""],                 // R-1 운반로봇 → R-1 운반
];

function shortName(name: string): string {
  let out = name;
  for (const [re, to] of SHORT_RULES) out = out.replace(re, to);
  return out.replace(/\s+/g, " ").trim() || name;
}

/** 「4분」 — 문구 안에 넣을 때 쓴다 (timeAgo 는 「4분 전」이라 문장에 안 붙는다) */
function elapsed(ts: string | null): string {
  const t = timeAgo(ts);
  return t.endsWith(" 전") ? t.slice(0, -2) : t;
}

/** 가장 나쁜 축을 고른다 — 같은 등급이면 앞에 적힌 축이 이긴다 (수신 > 값) */
function worst(axes: DeviceAxis[]): DeviceAxis {
  return axes.reduce((a, b) => ((SEV_RANK[b.sev] ?? 0) > (SEV_RANK[a.sev] ?? 0) ? b : a));
}

function mk(
  id: string, kind: DeviceKind, name: string, axes: DeviceAxis[],
  extra?: Partial<DeviceStatus>,
): DeviceStatus {
  const w = axes.length ? worst(axes) : { axis: "", sev: "idle", text: "확인 중" };
  return {
    id, kind, name, short: shortName(name),
    sev: w.sev,
    label: w.sev === "ok" ? "정상" : w.text,
    worstAxis: w.axis,
    axes, ...extra,
  };
}

/** 수신 축 — 통신 판정(FR-37)을 그대로 문구로 옮긴다 */
function commAxis(state: string, ts: string | null): DeviceAxis {
  if (state === "unmonitored") {
    // 대장에는 있는데 값이 한 번도 오지 않은 장치. 배지를 지우면 정상처럼 보인다.
    return { axis: "수신", sev: "warning", text: "데이터 없음" };
  }
  const c = CONN_STYLE[state] ?? CONN_STYLE.unknown;
  return {
    axis: "수신", sev: c.sev,
    text: c.sev === "ok" ? c.label : `${c.label} ${elapsed(ts)}`,
  };
}

/** 값 축 — 적정 범위는 설정의 알림 규칙(threshold)이 정한다 */
function valueAxis(s: SensorValue, range?: { min: number | null; max: number | null }): DeviceAxis {
  const meta = SENSOR_META[s.sensor_type];
  const unit = meta?.unit ?? s.unit ?? "";
  if (s.value == null) return { axis: "값", sev: "idle", text: "값 없음" };
  const shown = `${s.value.toFixed(unit === "ppm" ? 0 : 1)}${unit}`;
  const side = rangeSide(s.value, range);
  if (side) {
    return { axis: "값", sev: "warning", text: `${shown} 적정 ${side === "over" ? "초과" : "미달"}` };
  }
  // 규칙이 없으면 적정 여부를 말하지 않는다 — 없는 기준을 통과했다고 적으면 거짓이다
  const hasRange = range?.min != null || range?.max != null;
  return { axis: "값", sev: "ok", text: hasRange ? `${shown} 적정` : shown };
}

/**
 * 장치별 상태 — 종류별로 묶어 돌려준다. 등록은 됐는데 값이 없는 장치도 남긴다
 * (목록에서 사라지면 「없는 장치」와 구분되지 않는다).
 */
export function deviceGroups(input: StatusInput): DeviceGroup[] {
  const { conns, ranges, names = {}, parents = {} } = input;
  const sensorById: Record<string, SensorValue> = {};
  for (const s of input.sensors) sensorById[s.sensor_id] = s;

  const nameOf = (id: string, fallback?: string | null) => names[id] || fallback || id;

  const items: Record<DeviceKind, DeviceStatus[]> = {
    robot: [], sensor: [], tank: [], station: [],
  };

  // 대장과 값을 합친다 — 값이 없는 로봇도 「데이터 없음」으로 남는다
  const robotById: Record<string, RobotValue> = {};
  for (const r of input.robots) robotById[r.device_id] = r;
  const robotIds = [...new Set([...(input.robotIds ?? []), ...input.robots.map((r) => r.device_id)])].sort();

  for (const id of robotIds) {
    const r = robotById[id];
    const live = deviceLiveness(id, "robot", conns, sensorById);
    const axes: DeviceAxis[] = [commAxis(live.state, live.ts)];
    if (r) {
      axes.push(
        r.battery_pct == null
          ? { axis: "배터리", sev: "idle", text: "—" }
          : {
              axis: "배터리",
              sev: r.battery_pct < 20 && !r.charging ? "caution" : "ok",
              text: r.charging ? `충전 중 ${Math.round(r.battery_pct)}%` : `${Math.round(r.battery_pct)}%`,
            },
      );
      // 오류는 phase 를 덮지 않고 나란히 온다 (§4.2) — 축을 따로 둔다
      if (r.error) {
        axes.push({
          axis: "오류", sev: r.error.severity === "caution" ? "caution" : "warning",
          text: r.error.message || r.error.code,
        });
      }
    }
    items.robot.push(mk(id, "robot", nameOf(id, conns[id]?.name), axes));
  }

  for (const s of input.sensors) {
    const live = deviceLiveness(s.sensor_id, "sensor", conns, sensorById, parents[s.sensor_id]);
    items.sensor.push(mk(
      s.sensor_id, "sensor", nameOf(s.sensor_id, s.name),
      [commAxis(live.state, live.ts), valueAxis(s, ranges[s.sensor_type])],
    ));
  }

  for (const t of input.tanks) {
    // 값의 출처는 수위계 센서다. 그 센서가 멎으면 잔량을 「확인 불가」로 말한다.
    const lv = sensorLiveness(sensorById[`${t.device_id}-lv`]?.ts ?? null);
    const badge = tankBadge(t.level_pct, lv);
    items.tank.push(mk(
      t.device_id, "tank", nameOf(t.device_id, t.name || TANK_LABEL[t.tank_type]),
      [{
        axis: "잔량", sev: badge.sev,
        text: t.level_pct == null ? badge.label : `${Math.round(t.level_pct)}% ${badge.label}`,
      }],
      { levelPct: t.level_pct },
    ));
  }

  for (const st of input.stations) {
    const state = STATION_STATE[st.state] ?? STATION_STATE.idle;
    items.station.push(mk(
      st.station_id, "station", nameOf(st.station_id, st.name),
      [{ axis: "작업", sev: state.sev, text: state.label }],
    ));
  }

  return KINDS.map((kind) => {
    const list = items[kind];
    const warn = list.filter((d) => d.sev === "warning").length;
    const caution = list.filter((d) => d.sev === "caution").length;
    const bad = warn + caution;
    return {
      kind, label: KIND_LABEL[kind], items: list, count: list.length,
      ratio: `${list.length - bad}/${list.length}`,
      // 심각도별로 따로 센다 — 최악 등급을 전체에 붙이면 「2대 점검 필요」처럼
      // 사실이 틀어진다 (실제로는 1대 점검 필요 + 1대 응답 지연이다)
      summary: bad === 0
        ? "모두 정상"
        : [warn ? `경고 ${warn}` : null, caution ? `주의 ${caution}` : null]
            .filter(Boolean).join(" · "),
      tone: warn ? "warning" : caution ? "caution" : "ok",
    };
  }).filter((g) => g.count > 0);
}

/** 고리 조각 순서 — 좋은 쪽에서 나쁜 쪽으로 (읽는 방향과 같게) */
export const RING_ORDER = ["ok", "busy", "idle", "caution", "warning"] as const;

/** 스냅샷을 그대로 입력으로 — farmStatus 가 화면과 같은 규칙을 쓰게 한다 */
export function inputFromSnapshot(snap: FarmSnapshot): StatusInput {
  const conns: Record<string, ConnState & { name?: string | null }> = {};
  const names: Record<string, string> = {};
  for (const c of snap.connections) {
    conns[c.device_id] = c;
    if (c.name) names[c.device_id] = c.name;
  }
  const parents: Record<string, string | null> = {};
  for (const s of snap.sensors) {
    if (s.name) names[s.sensor_id] = s.name;
    parents[s.sensor_id] = s.parent_device_id ?? null;
  }
  for (const t of snap.tanks) if (t.name) names[t.device_id] = t.name;
  for (const st of snap.stations) if (st.name) names[st.station_id] = st.name;
  return {
    sensors: snap.sensors, conns, robots: snap.robots,
    // 대장(robot_ids)이 있으면 그것을 쓴다. 없는 예전 응답에서는 연결 기록으로 갈음한다.
    robotIds: snap.robot_ids
      ?? snap.connections.filter((c) => c.device_type === "robot").map((c) => c.device_id),
    tanks: snap.tanks, stations: snap.stations, ranges: snap.ranges ?? {}, names, parents,
  };
}
