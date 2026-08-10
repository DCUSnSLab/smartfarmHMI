"use client";

/**
 * 전체 현황 집계 — 통합 대시보드 A 의 Fleet KPI·농장 카드 (FR-38).
 *
 * 농장별 스냅샷을 병렬로 모아 집계한다. WS 구독은 스코프 1개만 가능하므로
 * 전체 화면에서는 주기 폴링(기본 15s)으로 갱신한다.
 */

import { useCallback, useEffect, useState } from "react";
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
  connections: (ConnState & { device_type?: string | null })[];
  tanks: TankInfo[];
  stations: StationInfo[];
  rack: { slots?: number; pallets?: number; stored?: number; moving?: number; at_station?: number };
}

/** 헤더 한 줄에 들어가야 한다 — 셋까지 이름을 적고 나머지는 「외 N」 */
function nameList(ids: string[]): string {
  return ids.length <= 3
    ? ids.join(", ")
    : `${ids.slice(0, 3).join(", ")} 외 ${ids.length - 3}`;
}

export interface FarmStatus {
  sev: "ok" | "caution" | "warning";
  /** 점 옆 배지 문구 */
  label: string;
  /** 왜 그 색인지 — 상세 화면의 상태 요약이 그대로 읽어 준다 */
  reasons: string[];
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
  const reasons: string[] = [];

  // 정지가 최우선 — 다른 축이 모두 정상이어도 현장은 멈춰 있다
  if (stops.remote) reasons.push("원격 전체 정지 발동 중");
  const estop = stops.physical_estop;
  // farm_ids 가 없으면 어느 현장인지 알 수 없다 — 안전 쪽으로 본다 (controlBlocked 와 같은 규칙)
  if (estop && (estop.farm_ids?.includes(farmId) ?? true)) reasons.push("물리 비상정지 발동 중");
  if (reasons.length) return { sev: "warning", label: "정지 중", reasons };

  const isEdge = (c: { device_type?: string | null; device_id: string }) =>
    c.device_type === "edge" || c.device_id.startsWith("edge");
  const edgeDown = snap.connections.find((c) => isEdge(c) && c.state !== "online");
  // 엣지가 끊기면 그 뒤의 모든 값이 함께 멎는다. 개수를 세면 자기 통신 레코드가 있는
  // 장치(엣지·로봇·생육기)만 잡혀, 센서·탱크까지 오프라인으로 나오는 하드웨어 목록과
  // 숫자가 어긋난다. 파생 결과를 세는 대신 원인 하나를 말한다.
  if (edgeDown) {
    return edgeDown.state === "offline"
      ? { sev: "warning", label: "경고", reasons: ["엣지 통신 단절, 농장 데이터 수신 중단"] }
      : { sev: "caution", label: "주의", reasons: ["엣지 응답 지연, 값 갱신 느려짐"] };
  }

  const offline = snap.connections.filter((c) => c.state === "offline");
  const degraded = snap.connections.filter((c) => c.state === "degraded");
  const staleSensors = snap.sensors.filter((s) => sensorLiveness(s.ts) === "offline");
  const lateSensors = snap.sensors.filter((s) => sensorLiveness(s.ts) === "degraded");

  if (offline.length) reasons.push(`통신 단절: ${nameList(offline.map((c) => c.device_id))}`);
  if (staleSensors.length) reasons.push(`값 두절: ${nameList(staleSensors.map((s) => s.sensor_id))}`);
  if (reasons.length) return { sev: "warning", label: "경고", reasons };

  if (degraded.length) reasons.push(`응답 지연: ${nameList(degraded.map((c) => c.device_id))}`);
  if (lateSensors.length) reasons.push(`수신 지연: ${nameList(lateSensors.map((s) => s.sensor_id))}`);
  if (reasons.length) return { sev: "caution", label: "주의", reasons };

  return { sev: "ok", label: "정상", reasons: ["정지·통신·센서 모두 정상"] };
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
