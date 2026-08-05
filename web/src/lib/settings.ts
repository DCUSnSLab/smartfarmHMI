"use client";

/**
 * 설정(팜·설비 관리) API 헬퍼 — 모두 nginx 단일 진입점(/api) 경유.
 * 쓰기는 api 계층에서 admin/manager 가드(403). monitor.ts 의 fetch 패턴을 따른다.
 */

import { apiFetch } from "@/lib/api";

export interface DiscoveredDevice {
  device_id: string;
  device_type: string;
  sensors: { sensor_id: string; sensor_type: string; unit: string }[];
  msg_count: number;
  last_seen: string | null;
}

export interface DiscoveredFarm {
  farm_id: string;
  device_count: number;
  sensor_count: number;
  first_seen: string | null;
  last_seen: string | null;
  devices: DiscoveredDevice[];
}

export interface DeviceDetail {
  sensor_type?: string;
  unit?: string;
  parent_device_id?: string | null;
  last_value?: number | null;
  tank_type?: string;
  capacity_l?: number;
  consumption_rate?: number | null;
  consumption_unit?: string | null;
  command?: string;
  affects_sensor_id?: string | null;
  power_kw?: number | null;
  station_type?: string;
}

export interface DeviceRow {
  device_id: string;
  device_type: string;
  name: string;
  model: string | null;
  location: string | null;
  detail: DeviceDetail | null;
}

export interface FarmInput {
  farm_id: string;
  name: string;
  farm_type: string;
  crop?: string | null;
  region_code: string;
  latitude: number;
  longitude: number;
  accuracy_m?: number;
}

async function jsonOk(res: Response): Promise<boolean> {
  return res.ok;
}

// ── 발견(discovery) ──
export async function listDiscovery(): Promise<DiscoveredFarm[]> {
  const r = await apiFetch("/api/discovery");
  return r.ok ? r.json() : [];
}

export async function registerDiscovered(
  farmId: string,
  meta: { name: string; farm_type: string; crop?: string | null },
): Promise<boolean> {
  return jsonOk(
    await apiFetch(`/api/discovery/${farmId}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    }),
  );
}

// ── 팜 CRUD ──
export async function createFarm(input: FarmInput): Promise<boolean> {
  return jsonOk(
    await apiFetch("/api/farms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateFarm(
  farmId: string,
  patch: {
    name?: string;
    farm_type?: string;
    crop?: string | null;
    region_code?: string;
    latitude?: number;
    longitude?: number;
    accuracy_m?: number;
  },
): Promise<boolean> {
  return jsonOk(
    await apiFetch(`/api/farms/${farmId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteFarm(farmId: string): Promise<boolean> {
  return jsonOk(await apiFetch(`/api/farms/${farmId}`, { method: "DELETE" }));
}

// ── 장치(device_meta) + 상세 CRUD ──
export async function listDevices(farmId: string): Promise<DeviceRow[]> {
  const r = await apiFetch(`/api/farms/${farmId}/devices`);
  return r.ok ? r.json() : [];
}

export async function createDevice(
  farmId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return jsonOk(
    await apiFetch(`/api/farms/${farmId}/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function updateDevice(
  farmId: string,
  deviceId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return jsonOk(
    await apiFetch(`/api/farms/${farmId}/devices/${deviceId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

export async function deleteDevice(farmId: string, deviceId: string): Promise<boolean> {
  return jsonOk(await apiFetch(`/api/farms/${farmId}/devices/${deviceId}`, { method: "DELETE" }));
}

// ── UI 상수 ──
export const FARM_TYPES: { value: string; label: string }[] = [
  { value: "greenhouse", label: "온실" },
  { value: "plant_factory", label: "식물공장" },
  { value: "open_field", label: "노지" },
];

export const DEVICE_TYPES: { value: string; label: string }[] = [
  { value: "growbed", label: "생육기" },
  { value: "robot", label: "로봇" },
  { value: "tank", label: "탱크" },
  { value: "station", label: "워크스테이션" },
  { value: "sensor", label: "센서" },
  { value: "actuator", label: "액추에이터" },
  { value: "edge", label: "엣지" },
];

export const DEVICE_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DEVICE_TYPES.map((d) => [d.value, d.label]),
);

export const SENSOR_TYPES = [
  "temperature", "humidity", "ec", "co2", "illuminance", "power", "water_level",
];
export const TANK_TYPES = ["nutrient", "water", "pesticide", "cleaning"];
export const STATION_TYPES = ["nutrient", "water", "pesticide", "cleaning"];
export const ACTUATOR_COMMANDS = [
  "set_temperature", "set_humidity", "set_ec", "set_led", "set_auto_mode",
];
