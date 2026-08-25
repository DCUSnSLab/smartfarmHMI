"use client";

/**
 * 농장 상세 화면용 보조 데이터 — 공유 스냅샷 읽기와 환경 이력 조회.
 *
 * 장비 명단·이름·부모 생육기·적정 범위는 모두 스냅샷이 싣고 온다. 예전에는 장비
 * 목록과 알림 규칙을 화면에서 따로 받았는데, 그러면 요청이 늘 뿐 아니라 **농장을
 * 옮긴 직후 이전 농장 목록이 남아** 개수와 등급이 요동친다. 스냅샷은 농장별로
 * 담겨 있어 옮긴 즉시 새 농장 것이 있다.
 */

import { apiFetch } from "@/lib/api";
import { useFarmData } from "@/lib/farmData";
import type { FarmSnapshot } from "@/lib/fleet";

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

export interface HistoryPoint { ts: string; avg: number; min: number; max: number }

export async function fetchHistory(
  farmId: string, sensorType: string, hours = 24, bucketMin = 30,
): Promise<HistoryPoint[]> {
  const r = await apiFetch(
    `/api/farms/${farmId}/environment/history?sensor_type=${sensorType}&hours=${hours}&bucket_min=${bucketMin}`,
  );
  return r.ok ? r.json() : [];
}
