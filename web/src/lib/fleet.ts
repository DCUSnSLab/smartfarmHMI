"use client";

/**
 * 전체 현황 집계 — 통합 대시보드 A 의 Fleet KPI·농장 카드 (FR-38).
 *
 * 농장별 스냅샷을 병렬로 모아 집계한다. WS 구독은 스코프 1개만 가능하므로
 * 전체 화면에서는 주기 폴링(기본 15s)으로 갱신한다.
 */

import { useCallback, useEffect, useState } from "react";
import { useVisiblePolling } from "@/lib/poll";
import { apiFetch } from "@/lib/api";
import { sensorLiveness, type ConnState, type RobotValue, type SensorValue, type StopState } from "@/lib/monitor";

export interface TankInfo {
  device_id: string;
  name: string;
  tank_type: string;
  capacity_l: number;
  level_pct: number | null;
  remain_l: number | null;
  days_left: number | null;
  uses_left: number | null;
}

export interface StationInfo {
  station_id: string;
  station_type: string;
  state: string;
}

export interface FarmSnapshot {
  farm: { farm_id: string; name: string; farm_type: string; crop: string | null };
  sensors: SensorValue[];
  robots: RobotValue[];
  connections: (ConnState & { device_type?: string | null; name?: string | null })[];
  tanks: TankInfo[];
  stations: StationInfo[];
  rack: { slots?: number; pallets?: number; stored?: number; moving?: number; at_station?: number };
}

/** 한 줄에 들어가야 한다 — 셋까지 이름을 적고 나머지는 「외 N」.
 *  쉼표는 이 목록에서만 쓴다 — 사유 문구에 넣으면 장치 이름 구분과 섞여 읽힌다. */
function nameList(names: string[]): string {
  return names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}`;
}

/** 사유 한 건 — 화면은 이걸 칩 하나로 그린다 (색은 sev) */
export interface FarmReason {
  sev: "caution" | "warning";
  text: string;
}

export interface FarmStatus {
  sev: "ok" | "caution" | "warning";
  /** 점 옆 배지 문구 */
  label: string;
  /** 왜 그 색인지 — 상세 화면의 상태 요약이 칩으로 나열한다 */
  reasons: FarmReason[];
}

/**
 * 농장 상태 파생 — 점 색과 배지의 유일한 근거.
 *
 * 세 축만 본다: **정지 · 장치 통신 · 센서 신선도**. 미확인 알림은 넣지 않는다 —
 * 읽었는지 여부는 사람의 처리 상태이지 농장의 상태가 아니고, 확인만 눌러도
 * 색이 바뀌어 현장이 나아진 것처럼 보인다 (미확인 건수는 KPI 타일이 따로 센다).
 *
 * 센서를 함께 보는 이유: 엣지가 살아 있어도 센서 값이 멎으면 화면의 수치가 과거에
 * 멈춘 채로 정상처럼 보인다. 임계는 장치 목록과 같다 (monitor.sensorLiveness).
 */
export function farmStatus(snap: FarmSnapshot, stops: StopState): FarmStatus {
  const farmId = snap.farm.farm_id;
  const reasons: FarmReason[] = [];
  let warn = false;
  let caution = false;

  // ── 정지 ──
  if (stops.remote) reasons.push({ sev: "warning", text: "원격 전체정지 발동 중" });
  const estop = stops.physical_estop;
  // farm_ids 가 없으면 어느 현장인지 알 수 없다 — 안전 쪽으로 본다 (controlBlocked 와 같은 규칙)
  if (estop && (estop.farm_ids?.includes(farmId) ?? true)) {
    reasons.push({ sev: "warning", text: "물리 비상정지 발동 중" });
  }
  const stopped = reasons.length > 0;

  // ── 통신 ──
  // 장치와 센서를 한 목록으로 합친다. 상태 이름은 하드웨어 목록과 같은 말을 쓴다
  // (정상 · 응답 지연 · 오프라인) — 같은 장치가 화면마다 다른 말로 불리면 안 된다.
  // 엣지를 맨 앞에 두어 원인이 먼저 읽히게 한다 (뒤의 장치는 대개 그 결과다).
  const isEdge = (c: { device_type?: string | null; device_id: string }) =>
    c.device_type === "edge" || c.device_id.startsWith("edge");
  const byEdgeFirst = [...snap.connections].sort(
    (a, b) => Number(isEdge(b)) - Number(isEdge(a)),
  );

  // 탱크는 빼둔다 — 발행 주체가 아니라 수위계 센서가 값의 출처이고, 그 센서는
  // 아래 목록에 이미 들어 있다. 둘 다 세면 같은 고장이 두 번 잡힌다
  // (하드웨어 목록의 탱크 행도 통신이 아니라 잔량을 보여준다).
  const pick = (want: "offline" | "degraded") => [
    ...byEdgeFirst.filter((c) => c.state === want).map((c) => c.name || c.device_id),
    ...snap.sensors.filter((s) => sensorLiveness(s.ts) === want).map((s) => s.name || s.sensor_id),
  ];
  const offline = pick("offline");
  const degraded = pick("degraded");
  if (offline.length) { reasons.push({ sev: "warning", text: `오프라인: ${nameList(offline)}` }); warn = true; }
  if (degraded.length) { reasons.push({ sev: "caution", text: `응답 지연: ${nameList(degraded)}` }); caution = true; }

  // 색은 가장 높은 단계를 따르되, 사유는 지금 걸린 것을 모두 남긴다. 정지는 제어·작업을
  // 멈출 뿐 통신을 끊지 않는다 — 센서를 손보려고 정지시킨 사람은 정지 중에도 그 센서가
  // 붙었는지 봐야 하고, 정지를 풀어야 비로소 알 수 있게 되면 안 된다.
  if (stopped) return { sev: "warning", label: "정지 중", reasons };
  if (warn) return { sev: "warning", label: "경고", reasons };
  if (caution) return { sev: "caution", label: "주의", reasons };
  return { sev: "ok", label: "정상", reasons: [] };
}

/**
 * 전 농장 스냅샷을 실제로 쓰는 화면 — 대시보드 카드와 스코프 스위처 점.
 * FarmScopeNav 의 표시 조건이기도 하다 — 조건을 두 곳에 적으면 갈라진다.
 */
export const showsFleetNav = (pathname: string) =>
  pathname === "/" || /^\/farms\/[^/]+/.test(pathname);

/**
 * 전 농장 스냅샷 폴링. 소유자는 하나여야 한다 (FarmDataProvider) — 두 곳에서
 * 부르면 틱당 요청이 두 배가 된다.
 *
 * farmIds 가 비면 요청을 건너뛰고 직전 값을 유지한다 — 쓰지 않는 화면에서 폴링을
 * 멈추되, 되돌아왔을 때 빈 카드가 보이지 않게 하기 위한 것이다.
 */
export function useFleetSnapshots(farmIds: string[], liveTick = 0, intervalMs = 15000) {
  const [snaps, setSnaps] = useState<Record<string, FarmSnapshot>>({});
  const key = farmIds.join(",");

  // 농장별로 부르면 요청 수도 미들웨어 질의 수도 농장 수에 비례한다.
  // 묶음 조회 하나로 받는다 — 없는 농장은 응답에서 빠진다.
  const load = useCallback(async () => {
    if (!key) return;
    const r = await apiFetch(`/api/farms/snapshots?ids=${encodeURIComponent(key)}`);
    if (r.ok) setSnaps(await r.json() as Record<string, FarmSnapshot>);
  }, [key]);

  // 쓰지 않는 화면(key 없음)과 숨은 탭에서는 돌지 않는다
  useVisiblePolling(load, intervalMs, Boolean(key));

  // 통신·정지 변화가 실시간으로 오면 다음 폴링을 기다리지 않는다. 현장에서 엣지가
  // 끊긴 순간 농장 점과 헤더가 같이 바뀌어야 한다 (새로고침 없이).
  useEffect(() => {
    if (!key || !liveTick) return;
    void load();
  }, [liveTick, key, load]);

  return snaps;
}

export function sensorOf(snap: FarmSnapshot | undefined, type: string): SensorValue | undefined {
  return snap?.sensors.find((s) => s.sensor_type === type);
}
