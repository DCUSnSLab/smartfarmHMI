/**
 * 상태 어휘 — 등급·문구·색과, 등급을 정하는 규칙.
 *
 * React 를 쓰지 않는다. 판정 로직(lib/deviceStatus, lib/fleet)이 이 어휘를 쓰는데,
 * 그게 컴포넌트 파일 안에 있으면 순수 로직이 next/link 까지 끌고 들어와 단독으로
 * 시험하거나 서버에서 쓸 수 없다. 그려 주는 것(StatusMark·StatusDot 등)은
 * components/ui.tsx 에, 무엇이 어떤 등급인지는 여기에 둔다.
 *
 * 화면 전체가 같은 어휘를 쓴다 — 같은 장치가 화면마다 다른 말로 불리면 사람이
 * 매번 다시 읽어야 한다.
 */

export const SEV_STYLE: Record<string, { dot: string; text: string; bg: string; border: string; label: string; hex: string }> = {
  ok: { dot: "bg-status-ok", text: "text-primary-dark", bg: "bg-primary-bg", border: "border-[#BFE8D3]", label: "정상", hex: "#00C271" },
  caution: { dot: "bg-status-caution", text: "text-status-cautionDark", bg: "bg-status-caution/10", border: "border-[#F7DFB0]", label: "주의", hex: "#F5A623" },
  warning: { dot: "bg-status-warning", text: "text-status-warningDark", bg: "bg-status-warning/10", border: "border-[#F7C4C9]", label: "경고", hex: "#F04452" },
  info: { dot: "bg-status-info", text: "text-status-infoDark", bg: "bg-status-info/10", border: "border-[#BFD6F8]", label: "정보", hex: "#3182F6" },
  // 작업 중·대기는 「정상/주의/경고」와 다른 축이다 — 일이 돌고 있나 없나일 뿐
  // 고장이 아니다. 그래서 초록(정상)에 섞지 않고 따로 둔다.
  busy: { dot: "bg-status-infoDark", text: "text-status-infoDark", bg: "bg-status-info/10", border: "border-[#BFD6F8]", label: "작업 중", hex: "#1B64DA" },
  idle: { dot: "bg-status-idle", text: "text-status-idleDark", bg: "bg-surface", border: "border-[#DDE2E7]", label: "대기", hex: "#B0B8C1" },
};

/** 어느 등급이 더 나쁜가 — 여러 축을 가진 장치의 대표 등급을 고를 때 쓴다.
 *  작업 중·정상은 같은 높이다 (둘 다 이상이 없다). 대기는 그보다 아래 — 정보량이 적다. */
export const SEV_RANK: Record<string, number> = {
  warning: 4, caution: 3, ok: 2, busy: 2, info: 1, idle: 1,
};

/** SVG 는 Tailwind 클래스를 못 받는다 — 같은 색을 hex 로 꺼내 쓴다 */
export const sevHex = (sev: string) => (SEV_STYLE[sev] ?? SEV_STYLE.info).hex;

/**
 * 값이 적정 범위를 벗어났나, 벗어났으면 어느 쪽인가.
 *
 * 상태 화면의 센서 등급과 생육기·센서 화면의 「범위 밖」 표시가 같은 판정을 써야 한다.
 * 각자 적어 두면 경계 처리(이상/초과)나 한쪽만 설정된 범위를 다르게 다루게 되고,
 * 같은 센서를 한 화면은 경고로 다른 화면은 정상으로 부른다.
 *
 * 범위가 없으면 벗어났다고 말하지 않는다 — 없는 기준을 어겼다고 할 수는 없다.
 */
export function rangeSide(
  value: number | null | undefined,
  range?: { min: number | null; max: number | null },
): "over" | "under" | null {
  if (value == null || !range) return null;
  if (range.max != null && value > range.max) return "over";
  if (range.min != null && value < range.min) return "under";
  return null;
}

export const CONN_STYLE: Record<string, { label: string; sev: string }> = {
  online: { label: "정상", sev: "ok" },
  degraded: { label: "응답 지연", sev: "caution" },
  offline: { label: "오프라인", sev: "warning" },
  // 통신 상태 행이 없는 장치 — 배지를 지우면 정상처럼 보인다.
  unknown: { label: "통신 상태 미확인", sev: "caution" },
};

/**
 * 탱크 표시 — 통신 상태(CONN_STYLE)와 **다른 축**이다.
 *
 * 탱크는 발행 주체가 아니다. 값의 출처는 수위계 센서(`{탱크}-lv`)이고, 탱크 자체는
 * birth·하트비트·LWT 가 없다. 그래서 「탱크 오프라인」은 실제로 수위계 이야기이고,
 * 같은 고장이 목록에 두 줄로 나온다 (워크스테이션을 통신 축에서 뺀 것과 같은 이유).
 * 대신 탱크가 실제로 말해 줄 수 있는 것 — 잔량 — 을 보여준다.
 *
 * 20% 기준과 「잔량 부족」 문구는 작업·공급 화면과 같은 값을 쓴다.
 */
export const TANK_LOW_PCT = 20;

export function tankBadge(
  levelPct: number | null | undefined,
  sensorState: "online" | "degraded" | "offline",
): { label: string; sev: string } {
  if (sensorState === "offline" || levelPct == null) {
    return { label: "수위 확인 불가", sev: "warning" };
  }
  if (sensorState === "degraded") return { label: "수위 갱신 지연", sev: "caution" };
  // 비었으면 경고다 — 잔량 부족(주의)과 같은 색으로 두면 「채워야 함」과
  // 「이미 못 씀」이 구분되지 않는다. 기준값은 추후 농장별 설정으로 옮긴다.
  if (levelPct <= 0) return { label: "잔량 소진", sev: "warning" };
  return levelPct <= TANK_LOW_PCT
    ? { label: "잔량 부족", sev: "caution" }
    : { label: "적정", sev: "ok" };
}

/**
 * 워크스테이션 작업 상태 — 통신 상태(CONN_STYLE)와 **다른 축**이다.
 * 워크스테이션은 자기 통신 경로가 없어(FR-37 대상은 엣지·센서·로봇) 이 상태로 표시한다.
 * 상태·작업공급 두 화면이 같은 문구를 쓰도록 여기 둔다 — 각자 적으면 갈라진다.
 */
export const STATION_STATE: Record<string, { label: string; sev: string }> = {
  idle: { label: "대기", sev: "idle" },
  busy: { label: "작업 중", sev: "busy" },
  // 「이상」은 통신 이상과 섞여 읽힌다 — 조작이 아니라 현장 점검이 필요한 상태다
  fault: { label: "점검 필요", sev: "warning" },
};

export const SENSOR_META: Record<string, { name: string; unit: string; color: string }> = {
  temperature: { name: "온도", unit: "℃", color: "#F04452" },
  humidity: { name: "습도", unit: "%", color: "#3182F6" },
  ec: { name: "양분(EC)", unit: "", color: "#00A05A" },
  co2: { name: "CO₂", unit: "ppm", color: "#8B95A1" },
  illuminance: { name: "조도", unit: "klx", color: "#F5A623" },
  power: { name: "소모전력", unit: "kW", color: "#1B64DA" },
  water_level: { name: "탱크 수위", unit: "%", color: "#0E9AA0" },
};

export const TANK_LABEL: Record<string, string> = {
  nutrient: "양액", water: "급수", pesticide: "방재액", cleaning: "세정액",
};

/** 임무 진행 단계 (§4.2 `phase`). 오류는 축이 달라 `robot.error` 로 따로 그린다 */
export const PHASE_LABEL: Record<string, string> = {
  idle: "대기", moving: "이동 중", working: "작업 중", charging: "충전 중",
};
