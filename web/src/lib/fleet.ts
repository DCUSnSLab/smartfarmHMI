"use client";

/**
 * 전체 현황 집계 — 통합 대시보드 A 의 Fleet KPI·농장 카드 (FR-38).
 *
 * 농장별 스냅샷을 병렬로 모아 집계한다. WS 구독은 스코프 1개만 가능하므로
 * 전체 화면에서는 주기 폴링(기본 15s)으로 갱신한다.
 */

import { useCallback, useEffect, useState } from "react";
import { CONN_STYLE, SEV_RANK } from "@/lib/severity";
import { useVisiblePolling } from "@/lib/poll";
import { apiFetch } from "@/lib/api";
import { deviceGroups, inputFromSnapshot, type Ranges } from "@/lib/deviceStatus";
import { type ConnState, type RobotValue, type SensorValue, type StopState } from "@/lib/monitor";

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
  /** 장비 등록의 표시 이름 — 사유 문구가 station_id 를 그대로 쓰면 못 알아본다 */
  name?: string | null;
}

export interface FarmSnapshot {
  farm: { farm_id: string; name: string; farm_type: string; crop: string | null };
  sensors: SensorValue[];
  robots: RobotValue[];
  connections: (ConnState & { device_type?: string | null; name?: string | null })[];
  tanks: TankInfo[];
  stations: StationInfo[];
  rack: { slots?: number; pallets?: number; stored?: number; moving?: number; at_station?: number };
  /**
   * 적정 범위 — 설정의 알림 규칙(threshold) 상·하한. 스냅샷에 실어야 farmStatus 가
   * 값 축을 볼 수 있다. 화면에서만 판정하면 농장 헤더의 「외 N건」과 상태 요약의
   * 칩 개수가 갈린다 (근거가 둘이 되므로).
   */
  ranges?: Ranges;
  /**
   * 대장에 등록된 로봇 — 값이 한 번도 오지 않은 로봇도 목록과 판정에 남긴다.
   * 이게 없으면 화면(대장 기준)과 농장 상태(스냅샷 기준)의 대수가 갈린다.
   */
  robot_ids?: string[];
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
 * 축은 **정지 · 장치 상태**다. 장치 상태는 deviceStatus.deviceGroups 가 만든다 —
 * 상태 화면의 설비 현황·하드웨어·배치도가 쓰는 것과 같은 함수다. 그래서 농장 헤더의
 * 「경고 · … 외 3건」과 상태 요약 카드의 칩 개수가 항상 맞는다. 예전에는 여기서
 * 통신만 따로 세고 값·잔량·작업 상태는 보지 않아, 상한을 넘은 CO₂ 나 바닥난 탱크가
 * 대시보드에서 초록으로 남았다.
 *
 * 미확인 알림은 넣지 않는다 — 읽었는지 여부는 사람의 처리 상태이지 농장의 상태가
 * 아니고, 확인만 눌러도 색이 바뀌어 현장이 나아진 것처럼 보인다.
 */
export function farmStatus(snap: FarmSnapshot, stops: StopState): FarmStatus {
  const farmId = snap.farm.farm_id;
  const reasons: FarmReason[] = [];

  // ── 정지 ──
  if (stops.remote) reasons.push({ sev: "warning", text: "원격 전체정지 발동 중" });
  const estop = stops.physical_estop;
  // farm_ids 가 없으면 어느 현장인지 알 수 없다 — 안전 쪽으로 본다 (controlBlocked 와 같은 규칙)
  if (estop && (estop.farm_ids?.includes(farmId) ?? true)) {
    reasons.push({ sev: "warning", text: "물리 비상정지 발동 중" });
  }
  const stopped = reasons.length > 0;

  // ── 엣지·생육기 ──
  // 하드웨어 목록의 네 종류(로봇·센서·탱크·워크스테이션)에는 없지만 원인은 대개
  // 이쪽이다. 먼저 적어 헤더 한 줄에 결과가 아니라 원인이 오게 한다.
  const groups = deviceGroups(inputFromSnapshot(snap));
  const inGroups = new Set(groups.flatMap((g) => g.items.map((d) => d.id)));
  const upstream = snap.connections.filter(
    (c) => !inGroups.has(c.device_id) && c.state !== "online",
  );
  for (const c of upstream) {
    const style = CONN_STYLE[c.state] ?? CONN_STYLE.unknown;
    reasons.push({
      sev: style.sev === "warning" ? "warning" : "caution",
      text: `${c.name || c.device_id} ${style.label}`,
    });
  }

  // ── 장치 ──
  // 엣지·생육기가 끊긴 동안에는 그 아래 장치의 「수신」 사유를 적지 않는다. 원인은
  // 위에 이미 한 줄로 있고, 여기에 또 적으면 센서 아홉 개가 같은 고장을 아홉 번
  // 반복한다 (헤더가 「외 12건」이 되어 정작 무엇이 문제인지 가려진다).
  const cascade = upstream.length > 0;
  const bad = groups
    .flatMap((g) => g.items)
    .filter((d) => d.sev === "warning" || d.sev === "caution")
    .filter((d) => !(cascade && d.worstAxis === "수신"));

  for (const d of [...bad].sort((a, b) => (SEV_RANK[b.sev] ?? 0) - (SEV_RANK[a.sev] ?? 0))) {
    reasons.push({ sev: d.sev === "warning" ? "warning" : "caution", text: `${d.name} ${d.label}` });
  }

  // 색은 가장 높은 단계를 따르되, 사유는 지금 걸린 것을 모두 남긴다. 정지는 제어·작업을
  // 멈출 뿐 통신을 끊지 않는다 — 센서를 손보려고 정지시킨 사람은 정지 중에도 그 센서가
  // 붙었는지 봐야 하고, 정지를 풀어야 비로소 알 수 있게 되면 안 된다.
  if (stopped) return { sev: "warning", label: "정지 중", reasons };
  if (reasons.some((r) => r.sev === "warning")) return { sev: "warning", label: "경고", reasons };
  if (reasons.length) return { sev: "caution", label: "주의", reasons };
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
