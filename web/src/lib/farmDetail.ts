"use client";

/**
 * 농장 상세 화면용 보조 데이터 — 스냅샷(탱크·WS·랙·적정범위)과 장비 목록.
 *
 * 적정 범위는 스냅샷이 싣고 오므로 여기서 알림 규칙을 따로 부르지 않는다 — 따로
 * 받으면 게이지와 농장 상태 판정이 서로 다른 범위를 보게 된다.
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useFarmData } from "@/lib/farmData";
import type { FarmSnapshot } from "@/lib/fleet";
import type { DeviceRow } from "@/lib/settings";

/**
 * 스냅샷 — WS 가 커버하지 않는 탱크·WS·랙 정보. 셸이 이미 전 농장 스냅샷을 15 초마다
 * 갱신하므로(FarmDataProvider.snaps) 여기서 따로 폴링하지 않는다. 예전처럼 20 초
 * 주기로 다시 받으면 상세 화면에서 같은 농장 스냅샷이 두 번씩 나간다.
 *
 * 호출처가 /farms/[farmId]/* 뿐이라 공유 스냅샷이 항상 켜져 있다 (showsFleetNav).
 */
export function useFarmSnapshot(farmId: string): FarmSnapshot | null {
  const { snaps } = useFarmData();
  return snaps[farmId] ?? null;
}

export function useDevices(farmId: string) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  useEffect(() => {
    apiFetch(`/api/farms/${farmId}/devices`).then(async (r) => r.ok && setDevices(await r.json()));
  }, [farmId]);
  return devices;
}

export interface HistoryPoint { ts: string; avg: number; min: number; max: number }

export async function fetchHistory(
  farmId: string, sensorType: string, hours = 24, bucketMin = 30,
): Promise<HistoryPoint[]> {
  const r = await apiFetch(
    `/api/farms/${farmId}/environment/history?sensor_type=${sensorType}&hours=${hours}&bucket_min=${bucketMin}`,
  );
  return r.ok ? r.json() : [];
}
