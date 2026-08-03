"use client";

/** 농장 상세 화면용 보조 데이터 — 스냅샷(탱크·WS·랙)·장비 목록·알림 규칙(적정범위). */

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { FarmSnapshot } from "@/lib/fleet";
import type { DeviceRow } from "@/lib/settings";

export interface AlertRule {
  id: number;
  alert_kind: string;
  sensor_type: string | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
}

/** 스냅샷 폴링 — WS 가 커버하지 않는 탱크·WS·랙 정보 갱신용 */
export function useFarmSnapshot(farmId: string, intervalMs = 20000) {
  const [snap, setSnap] = useState<FarmSnapshot | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch(`/api/farms/${farmId}/snapshot`);
    if (r.ok) setSnap(await r.json());
  }, [farmId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);
  return snap;
}

/** 적정범위 — alert_rule 의 임계값을 게이지 범위로 재사용 (FR-08 표시) */
export function useRanges(farmId: string) {
  const [ranges, setRanges] = useState<Record<string, { min: number | null; max: number | null }>>({});
  useEffect(() => {
    apiFetch(`/api/farms/${farmId}/alert-rules`).then(async (r) => {
      if (!r.ok) return;
      const rules: AlertRule[] = await r.json();
      setRanges(Object.fromEntries(
        rules
          .filter((x) => x.alert_kind === "threshold" && x.sensor_type)
          .map((x) => [x.sensor_type as string, { min: x.min_value, max: x.max_value }]),
      ));
    });
  }, [farmId]);
  return ranges;
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
