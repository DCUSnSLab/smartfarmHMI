"use client";

/**
 * 전체 현황 집계 — 통합 대시보드 A 의 Fleet KPI·농장 카드 (FR-38).
 *
 * 농장별 스냅샷을 병렬로 모아 집계한다. WS 구독은 스코프 1개만 가능하므로
 * 전체 화면에서는 주기 폴링(기본 15s)으로 갱신한다.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ConnState, RobotValue, SensorValue } from "@/lib/monitor";

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
  connections: (ConnState & { device_type?: string | null })[];
  tanks: TankInfo[];
  stations: StationInfo[];
  rack: { slots?: number; pallets?: number; stored?: number; moving?: number; at_station?: number };
}

/** 농장 상태 파생 — 엣지 오프라인=경고 / 지연 또는 미확인 경고=주의 / 그 외 정상 */
export function farmSeverity(snap: FarmSnapshot, unackedWarnings: number): "ok" | "caution" | "warning" {
  const edge = snap.connections.find((c) => c.device_type === "edge" || c.device_id.startsWith("edge"));
  if (edge && edge.state === "offline") return "warning";
  if (snap.connections.some((c) => c.state === "offline")) return "warning";
  if (snap.connections.some((c) => c.state === "degraded") || unackedWarnings > 0) return "caution";
  return "ok";
}

/**
 * 전 농장 스냅샷을 실제로 쓰는 화면 — 대시보드 카드와 스코프 스위처 점.
 * FarmScopeNav 의 표시 조건이기도 하다 — 조건을 두 곳에 적으면 갈라진다.
 */
export const showsFleetNav = (pathname: string) =>
  pathname === "/" || /^\/farms\/[^/]+/.test(pathname);

/**
 * 전 농장 스냅샷 폴링. 농장 수만큼 병렬 요청하므로 소유자는 하나여야 한다
 * (FarmDataProvider) — 두 곳에서 부르면 틱당 요청이 2N 건이 된다.
 *
 * farmIds 가 비면 요청을 건너뛰고 직전 값을 유지한다 — 쓰지 않는 화면에서 폴링을
 * 멈추되, 되돌아왔을 때 빈 카드가 보이지 않게 하기 위한 것이다.
 */
export function useFleetSnapshots(farmIds: string[], intervalMs = 15000) {
  const [snaps, setSnaps] = useState<Record<string, FarmSnapshot>>({});
  const key = farmIds.join(",");

  const load = useCallback(async () => {
    if (!key) return;
    const ids = key.split(",");
    const results = await Promise.all(
      ids.map(async (id) => {
        const r = await apiFetch(`/api/farms/${id}/snapshot`);
        return r.ok ? ([id, (await r.json()) as FarmSnapshot] as const) : null;
      }),
    );
    setSnaps(Object.fromEntries(results.filter(Boolean) as [string, FarmSnapshot][]));
  }, [key]);

  useEffect(() => {
    if (!key) return;   // 쓰지 않는 화면 — 아무 일도 안 하는 타이머를 남기지 않는다
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [key, load, intervalMs]);

  return snaps;
}

export function sensorOf(snap: FarmSnapshot | undefined, type: string): SensorValue | undefined {
  return snap?.sensors.find((s) => s.sensor_type === type);
}
