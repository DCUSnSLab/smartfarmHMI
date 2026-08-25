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
  name: string | null;
  farm_type: string | null;
  crop: string | null;
  region_code: string | null;
  address: string | null;
  zipcode: string | null;
  latitude: number | null;
  longitude: number | null;
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
  // false = 데이터는 들어오는데 대장에 없는 장치. 운영 화면에는 나오지 않는다.
  registered: boolean;
  last_seen?: string | null;
}

export interface FarmLocationDebug {
  address_keyword: string | null;
  address: string | null;
  zipcode: string | null;
  latitude: number | null;
  longitude: number | null;
  region_code: string | null;
}

export class FarmLocationResolutionError extends Error {
  constructor(message: string, public debug: FarmLocationDebug) {
    super(message);
  }
}

export interface AddressCandidate {
  zipNo: string;
  roadAddr: string;
  jibunAddr: string;
}

export interface AddressSelectionRequired {
  needs_selection: true;
  address_keyword: string;
  candidates: AddressCandidate[];
  debug: FarmLocationDebug;
}

export interface AddressSearchResult {
  error_code: string;
  message: string;
  total_count: number;
  candidates: AddressCandidate[];
}

export async function searchFarmAddresses(keyword: string): Promise<AddressSearchResult> {
  const response = await apiFetch("/api/location/search-addresses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword }) });
  if (!response.ok) throw new Error("주소 검색에 실패했습니다.");
  return response.json();
}

export interface ResolvedFarmLocation {
  address_keyword: string;
  address: string;
  zipcode: string;
  latitude: number;
  longitude: number;
  region_code: string | null;
  region_code_warning: boolean;
}

export async function resolveCurrentFarmLocation(
  latitude: number,
  longitude: number,
): Promise<ResolvedFarmLocation | AddressSelectionRequired> {
  const response = await apiFetch("/api/location/resolve-current", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude, longitude }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new Error(
      typeof detail === "string" ? detail : "농장 위치를 확인하지 못했습니다.",
    );
  }
  if (body.error && body.debug) {
    throw new FarmLocationResolutionError(body.error, body.debug);
  }
  return body;
}


export async function resolveSelectedFarmAddress(
  addressKeyword: string,
  candidate: AddressCandidate,
): Promise<ResolvedFarmLocation> {
  const response = await apiFetch("/api/location/resolve-address", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address_keyword: addressKeyword,
      address: candidate.roadAddr,
      zipcode: candidate.zipNo,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.detail;
    throw new Error(
      typeof detail === "string" ? detail : "선택한 주소를 확인하지 못했습니다.",
    );
  }
  if (body.error && body.debug) {
    throw new FarmLocationResolutionError(body.error, body.debug);
  }
  return body;
}

export interface FarmInput {
  farm_id: string;
  name: string;
  farm_type: string;
  crop?: string | null;
  region_code?: string | null;
  address?: string | null;
  zipcode?: string | null;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
}

async function jsonOk(res: Response): Promise<boolean> {
  return res.ok;
}

// ── 발견(discovery) ──
export interface AlertRuleRow {
  id: number;
  alert_kind: string;
  sensor_type: string | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
}

/** 농장별 알림 규칙을 한 번에 — 설정 화면이 농장 수만큼 요청하지 않도록 */
export async function listAlertRules(farmIds: string[]): Promise<Record<string, AlertRuleRow[]>> {
  if (farmIds.length === 0) return {};
  const r = await apiFetch(`/api/alert-rules?farm_ids=${encodeURIComponent(farmIds.join(","))}`);
  return r.ok ? r.json() : {};
}

export async function listDiscovery(): Promise<DiscoveredFarm[]> {
  const r = await apiFetch("/api/discovery");
  return r.ok ? r.json() : [];
}

export async function registerDiscovered(
  farmId: string,
  meta: Omit<FarmInput, "farm_id">,
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
    region_code?: string | null;
    address?: string | null;
    zipcode?: string | null;
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
export async function listDevices(
  farmId: string,
  { includeUnregistered = false } = {},
): Promise<DeviceRow[]> {
  const q = includeUnregistered ? "?include_unregistered=1" : "";
  const r = await apiFetch(`/api/farms/${farmId}/devices${q}`);
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
