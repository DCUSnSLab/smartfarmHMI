"use client";

/**
 * 설정 · 농장·설비 관리 (FR-07·13·38) — admin/manager 전용.
 * 두 경로: (1) 발견된 스마트팜 등록, (2) 팜·장치 직접 추가/수정/삭제.
 * 데이터 CRUD 는 /lib/settings 헬퍼(→ api → middleware). 게이팅은 api 가 강제, 여기선 보조.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertRules } from "@/components/AlertRules";
import { PlannedChip } from "@/components/Planned";
import { ROLE_LABEL, canControl, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { FarmSummary, timeAgo } from "@/lib/monitor";
import { useVisiblePolling } from "@/lib/poll";
import {
  ACTUATOR_COMMANDS, AddressCandidate, DEVICE_TYPES, DEVICE_TYPE_LABEL, DeviceRow,
  DiscoveredFarm, FarmLocationResolutionError, ResolvedFarmLocation,
  FARM_TYPES, SENSOR_TYPES, STATION_TYPES, TANK_TYPES,
  createDevice, createFarm, deleteDevice, deleteFarm, listAlertRules, listDevices, listDiscovery,
  registerDiscovered, resolveCurrentFarmLocation, resolveSelectedFarmAddress,
  searchFarmAddresses, updateDevice, updateFarm,
} from "@/lib/settings";
import type { AlertRuleRow } from "@/lib/settings";

/** 참조가 매 렌더 바뀌면 AlertRules 의 초기값 동기화 effect 가 끝없이 돈다 */
const NO_RULES: AlertRuleRow[] = [];

const farmTypeLabel = (t: string) => FARM_TYPES.find((f) => f.value === t)?.label ?? t;

type LocationMode = "current" | "manual";

// ── 공용 모달 ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // 모달이 떠 있는 동안 뒤 페이지 스크롤을 잠근다 — 안 잠그면 모달 끝까지 굴렸을 때
  // 뒤 페이지가 따라 움직여 스크롤이 겹쳐 보인다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      {/* 둥근 모서리와 스크롤을 같은 요소에 두면 스크롤바가 모서리를 사각으로 덮는다.
          바깥이 모양(rounded + overflow-hidden)을, 안쪽이 스크롤을 맡는다.
          높이 상한은 vh 인데 내용은 rem 이라 큰 글씨에서 넘친다 — 그래서 안쪽만 흐른다. */}
      <div
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="shrink-0 px-5 pb-4 pt-5 text-16 font-extrabold">{title}</h3>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-13.5 font-semibold focus:border-primary focus:outline-none";
const labelCls = "block text-12.5 font-bold text-gray-600";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className={labelCls}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Actions({ onCancel, submitLabel, busy }: { onCancel: () => void; submitLabel: string; busy: boolean }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-13 font-bold text-gray-500">
        취소
      </button>
      <button type="submit" disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-13 font-extrabold text-white disabled:opacity-50">
        {busy ? "처리 중…" : submitLabel}
      </button>
    </div>
  );
}

// ── 팜 추가/수정 모달 ──
function FarmModal({
  edit, discovered, onClose, onDone,
}: {
  edit?: FarmSummary;
  discovered?: DiscoveredFarm;
  onClose: () => void;
  onDone: () => void;
}) {
  const initialFarm = edit ?? discovered;
  const [farmId, setFarmId] = useState(initialFarm?.farm_id ?? "");
  const [name, setName] = useState(initialFarm?.name ?? initialFarm?.farm_id ?? "");
  const [farmType, setFarmType] = useState(initialFarm?.farm_type ?? "greenhouse");
  const [crop, setCrop] = useState(initialFarm?.crop ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [locationMode, setLocationMode] = useState<LocationMode>("manual");
  const [address, setAddress] = useState(initialFarm?.address ?? "");
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedFarmLocation | null>(() =>
    initialFarm?.address && initialFarm.zipcode && initialFarm.latitude != null && initialFarm.longitude != null
      ? {
          address_keyword: initialFarm.address, address: initialFarm.address, zipcode: initialFarm.zipcode,
          latitude: initialFarm.latitude, longitude: initialFarm.longitude,
          region_code: initialFarm.region_code ?? null, region_code_warning: !initialFarm.region_code,
        }
      : null,
  );
  const [addressCandidates, setAddressCandidates] = useState<AddressCandidate[]>([]);
  const [selectedRoadAddress, setSelectedRoadAddress] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressSearchMessage, setAddressSearchMessage] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationDebug, setLocationDebug] = useState({
    address_keyword: null as string | null,
    address: initialFarm?.address ?? null,
    zipcode: initialFarm?.zipcode ?? null,
    latitude: initialFarm?.latitude ?? null,
    longitude: initialFarm?.longitude ?? null,
    region_code: initialFarm?.region_code ?? null,
  });

  const requestCurrentLocation = () => {
    setErr("");
    if (!("geolocation" in navigator)) {
      setErr("이 브라우저는 현재 위치 확인을 지원하지 않습니다.");
      return;
    }
    setLocating(true);
    setAddressCandidates([]);
    setSelectedRoadAddress("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setLocationDebug({
          address_keyword: null,
          address: null,
          zipcode: null,
          latitude: coords.latitude,
          longitude: coords.longitude,
          region_code: null,
        });
        try {
          const location = await resolveCurrentFarmLocation(coords.latitude, coords.longitude);
          if ("needs_selection" in location) {
            setResolvedLocation(null);
            setAddressCandidates(location.candidates);
            setLocationDebug(location.debug);
            return;
          }
          setResolvedLocation(location);
          setAddress(location.address);
          setLocationDebug({
            address_keyword: location.address_keyword,
            address: location.address,
            zipcode: location.zipcode,
            latitude: location.latitude,
            longitude: location.longitude,
            region_code: location.region_code,
          });
          if (location.region_code_warning) {
            window.alert("행정구역코드를 찾을 수 없음");
          }
        } catch (error) {
          setResolvedLocation(null);
          setAddress(initialFarm?.address ?? "");
          if (error instanceof FarmLocationResolutionError) {
            setLocationDebug(error.debug);
          }
          setErr(error instanceof Error ? error.message : "농장 위치를 확인하지 못했습니다.");
        } finally {
          setLocating(false);
        }
      },
      (error) => {
        const messages: Record<number, string> = {
          1: "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.",
          2: "현재 위치를 확인할 수 없습니다. 위치 서비스를 켠 뒤 다시 시도해 주세요.",
          3: "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.",
        };
        setResolvedLocation(null);
        setAddress(initialFarm?.address ?? "");
        setErr(messages[error.code] ?? "현재 위치를 가져오지 못했습니다.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const searchManualAddress = async () => {
    const keyword = addressQuery.trim();
    if (!keyword) {
      setAddressCandidates([]);
      setAddressSearchMessage("주소를 입력해 주세요.");
      return;
    }
    setLocating(true);
    setErr("");
    setAddressSearchMessage("");
    setResolvedLocation(null);
    setAddress(initialFarm?.address ?? "");
    setSelectedRoadAddress("");
    try {
      const result = await searchFarmAddresses(keyword);
      setAddressCandidates(result.candidates);
      setAddressSearchMessage(result.message);
      setLocationDebug({
        address_keyword: keyword, address: null, zipcode: null,
        latitude: null, longitude: null, region_code: null,
      });
    } catch (error) {
      setAddressCandidates([]);
      setAddressSearchMessage(error instanceof Error ? error.message : "주소 검색에 실패했습니다.");
    } finally {
      setLocating(false);
    }
  };

  const selectAddressCandidate = async (candidate: AddressCandidate) => {
    setLocating(true);
    setErr("");
    setSelectedRoadAddress(candidate.roadAddr);
    try {
      const location = await resolveSelectedFarmAddress(
        locationDebug.address_keyword ?? "",
        candidate,
      );
      setResolvedLocation(location);
      setAddress(location.address);
      setLocationDebug({
        address_keyword: location.address_keyword,
        address: location.address,
        zipcode: location.zipcode,
        latitude: location.latitude,
        longitude: location.longitude,
        region_code: location.region_code,
      });
      if (location.region_code_warning) {
        window.alert("행정구역코드를 찾을 수 없음");
      }
    } catch (error) {
      setResolvedLocation(null);
      if (error instanceof FarmLocationResolutionError) {
        setLocationDebug(error.debug);
      }
      setErr(error instanceof Error ? error.message : "선택한 주소를 확인하지 못했습니다.");
    } finally {
      setLocating(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedLocation) {
      setErr(locationMode === "current" ? "위치 확인을 완료해 주세요." : "주소를 검색하고 선택해 주세요.");
      return;
    }
    setBusy(true);
    setErr("");
    const locationPatch = resolvedLocation
      ? {
          address: resolvedLocation.address,
          zipcode: resolvedLocation.zipcode,
          latitude: resolvedLocation.latitude,
          longitude: resolvedLocation.longitude,
          region_code: resolvedLocation.region_code,
        }
      : {};
    const ok = discovered
      ? await registerDiscovered(discovered.farm_id, {
          name, farm_type: farmType, crop: crop || null, ...locationPatch,
        })
      : edit
        ? await updateFarm(edit.farm_id, {
            name, farm_type: farmType, crop: crop || null, ...locationPatch,
          })
        : await createFarm({
            farm_id: farmId.trim(), name, farm_type: farmType, crop: crop || null,
            ...locationPatch,
          });
    setBusy(false);
    if (ok) onDone();
    else setErr("저장에 실패했습니다. 입력값과 위치 정보를 확인하세요.");
  };

  return (
    <Modal
      title={discovered
        ? `발견된 팜 등록 · ${discovered.farm_id}`
        : edit ? `팜 수정 · ${edit.farm_id}` : "스마트팜 추가"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {discovered && (
          <p className="mb-3 text-12.5 font-semibold text-muted">
            장치 {discovered.device_count}대 · 센서 {discovered.sensor_count}종이 함께 등록됩니다.
          </p>
        )}
        {!edit && !discovered && (
          <Field label="farm_id (자연키 · MQTT 토픽 · 이후 변경 불가)">
            <input className={inputCls} value={farmId} onChange={(e) => setFarmId(e.target.value)} placeholder="예: gimje" required />
          </Field>
        )}
        <Field label="농장 이름">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김제 벼 논" required />
        </Field>
        <Field label="유형">
          <select className={inputCls} value={farmType} onChange={(e) => setFarmType(e.target.value)}>
            {FARM_TYPES.map((farm) => <option key={farm.value} value={farm.value}>{farm.label}</option>)}
          </select>
        </Field>
        <Field label="작물 (선택)">
          <input className={inputCls} value={crop} onChange={(e) => setCrop(e.target.value)} placeholder="예: 벼" />
        </Field>

        <div className="mb-3">
          <span className={labelCls}>농장 위치</span>
          <input
            className={`${inputCls} mt-1 disabled:bg-gray-50 disabled:text-gray-600`}
            value={address}
            placeholder="위치를 설정하면 농장 주소가 표시됩니다."
            disabled
            aria-label="농장 주소"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {([
              ["current", "현재 위치로 설정"],
              ["manual", "직접 설정"],
            ] as const).map(([value, label]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-12.5 font-bold ${
                  locationMode === value
                    ? "border-primary bg-primary-pale text-primary-dark"
                    : "border-gray-200 text-gray-600"
                }`}
              >
                <input
                  type="radio"
                  name="farm-location-mode"
                  value={value}
                  checked={locationMode === value}
                  onChange={() => {
                    setLocationMode(value);
                    setErr("");
                  }}
                  className="accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
          {locationMode === "current" && (
            <>
              <button
                type="button"
                onClick={requestCurrentLocation}
                disabled={locating}
                className="mt-2 w-full rounded-lg border border-primary px-3 py-2.5 text-13.5 font-extrabold text-primary-dark hover:bg-primary-bg disabled:cursor-wait disabled:opacity-60"
              >
                {locating ? "위치 확인 중…" : resolvedLocation || addressCandidates.length ? "위치 다시 확인" : "위치 확인"}
              </button>
            </>
          )}
          {locationMode === "manual" && (
            <div className="mt-2 flex gap-2">
              <input
                className={inputCls}
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void searchManualAddress();
                  }
                }}
                placeholder="도로명 또는 지번주소를 입력하세요."
                aria-label="농장 주소 검색어"
              />
              <button
                type="button"
                onClick={searchManualAddress}
                disabled={locating}
                className="shrink-0 rounded-lg bg-primary px-4 text-13 font-extrabold text-white disabled:opacity-50"
              >
                {locating ? "검색 중…" : "검색"}
              </button>
            </div>
          )}
          {(addressCandidates.length > 0 || addressSearchMessage) && (
            <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
              <div className="grid grid-cols-[64px_1fr_1fr] gap-2 bg-gray-50 px-2 py-1.5 text-11 font-bold text-gray-500">
                <span>우편번호</span>
                <span>도로명주소</span>
                <span>지번주소</span>
              </div>
              {addressSearchMessage && (
                <p className="border-t border-gray-100 px-3 py-3 text-center text-12.5 font-semibold text-gray-500">
                  {addressSearchMessage}
                </p>
              )}
              {addressCandidates.map((candidate) => (
                <button
                  key={`${candidate.zipNo}-${candidate.roadAddr}-${candidate.jibunAddr}`}
                  type="button"
                  onClick={() => selectAddressCandidate(candidate)}
                  disabled={locating}
                  className={`grid w-full grid-cols-[64px_1fr_1fr] gap-2 border-t border-gray-100 px-2 py-2 text-left text-11.5 hover:bg-primary-bg disabled:opacity-60 ${
                    selectedRoadAddress === candidate.roadAddr ? "bg-primary-pale" : "bg-white"
                  }`}
                >
                  <span>{candidate.zipNo || "-"}</span>
                  <span className="break-words">{candidate.roadAddr || "-"}</span>
                  <span className="break-words">{candidate.jibunAddr || "-"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {err && <p className="text-12.5 font-bold text-status-warningDark">{err}</p>}
        <Actions
          onCancel={onClose}
          submitLabel={discovered ? "등록" : edit ? "수정" : "추가"}
          busy={busy}
        />
      </form>
    </Modal>
  );
}

// ── 장치 추가/수정 모달 (유형별 상세 필드) ──
function DeviceModal({
  farmId, edit, candidates = [], preset, onClose, onDone,
}: {
  farmId: string;
  edit?: DeviceRow;
  /** 데이터는 들어오는데 등록되지 않은 장치 — 손으로 적는 대신 여기서 고른다. */
  candidates?: DeviceRow[];
  preset?: DeviceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>(() => ({
    device_id: edit?.device_id ?? preset?.device_id ?? "",
    device_type: edit?.device_type ?? preset?.device_type ?? "growbed",
    name: edit?.name ?? preset?.device_id ?? "",
    location: edit?.location ?? "",
    sensor_type: edit?.detail?.sensor_type ?? "temperature",
    unit: edit?.detail?.unit ?? "",
    parent_device_id: edit?.detail?.parent_device_id ?? "",
    tank_type: edit?.detail?.tank_type ?? "nutrient",
    capacity_l: edit?.detail?.capacity_l != null ? String(edit.detail.capacity_l) : "",
    station_type: edit?.detail?.station_type ?? "water",
    command: edit?.detail?.command ?? "set_temperature",
    affects_sensor_id: edit?.detail?.affects_sensor_id ?? "",
    power_kw: edit?.detail?.power_kw != null ? String(edit.detail.power_kw) : "",
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const t = f.device_type;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    let ok: boolean;
    if (edit) {
      const patch: Record<string, unknown> = { name: f.name, location: f.location || null };
      if (t === "sensor") Object.assign(patch, { sensor_type: f.sensor_type, unit: f.unit, parent_device_id: f.parent_device_id || null });
      if (t === "tank") Object.assign(patch, { tank_type: f.tank_type, capacity_l: f.capacity_l ? Number(f.capacity_l) : undefined });
      if (t === "station") Object.assign(patch, { station_type: f.station_type });
      if (t === "actuator") Object.assign(patch, { command: f.command, affects_sensor_id: f.affects_sensor_id || null, power_kw: f.power_kw ? Number(f.power_kw) : null });
      ok = await updateDevice(farmId, edit.device_id, patch);
    } else {
      const payload: Record<string, unknown> = {
        device_id: f.device_id.trim(), device_type: t, name: f.name, location: f.location || null,
      };
      if (t === "sensor") Object.assign(payload, { sensor_type: f.sensor_type, unit: f.unit, parent_device_id: f.parent_device_id || null });
      if (t === "tank") Object.assign(payload, { tank_type: f.tank_type, capacity_l: f.capacity_l ? Number(f.capacity_l) : undefined });
      if (t === "station") Object.assign(payload, { station_type: f.station_type });
      if (t === "actuator") Object.assign(payload, { command: f.command, affects_sensor_id: f.affects_sensor_id || null, power_kw: f.power_kw ? Number(f.power_kw) : null });
      ok = await createDevice(farmId, payload);
    }
    setBusy(false);
    if (ok) onDone();
    else setErr("저장에 실패했습니다. 필수 필드/중복(device_id)을 확인하세요.");
  };

  return (
    <Modal title={edit ? `장치 수정 · ${edit.device_id}` : `장치 추가 · ${farmId}`} onClose={onClose}>
      <form onSubmit={submit}>
        {!edit && (
          <>
            {/* 보이는 것을 고른다. 식별자를 손으로 적으면 한 글자만 틀려도 등록부와
                화면이 갈라져, 유령은 그대로 남고 쓰이지 않는 행이 하나 생긴다. */}
            {candidates.length > 0 ? (
              <Field label="등록할 장치">
                <select
                  className={inputCls}
                  value={f.device_id}
                  onChange={(e) => {
                    const pick = candidates.find((c) => c.device_id === e.target.value);
                    setF((prev) => ({
                      ...prev,
                      device_id: e.target.value,
                      device_type: pick?.device_type ?? prev.device_type,
                      name: prev.name === "" || prev.name === prev.device_id ? e.target.value : prev.name,
                    }));
                  }}
                  required
                >
                  <option value="">데이터가 들어오는 미등록 장치 {candidates.length}개</option>
                  {candidates.map((c) => (
                    <option key={c.device_id} value={c.device_id}>
                      {c.device_id} · {DEVICE_TYPE_LABEL[c.device_type] ?? c.device_type}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={t === "sensor" ? "sensor_id (MQTT 식별자)" : "device_id (MQTT 식별자)"}>
                <input className={inputCls} value={f.device_id} onChange={(e) => set("device_id", e.target.value)} placeholder="예: temp-b / growbed-02" required />
                <p className="mt-1 text-11.5 font-semibold text-muted">
                  아직 데이터가 들어오지 않은 장치입니다. 식별자는 엣지가 발행하는 값과 정확히 같아야 합니다.
                </p>
              </Field>
            )}
            <Field label="장치 유형">
              <select className={inputCls} value={t} onChange={(e) => set("device_type", e.target.value)}>
                {DEVICE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
          </>
        )}
        <Field label="이름">
          <input className={inputCls} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="예: A동 베드 4 / 온도센서 B" required />
        </Field>
        <Field label="설치·배치 위치 (선택)">
          <input className={inputCls} value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="예: A동 랙 3열 / 기계실" />
        </Field>

        {t === "sensor" && (
          <>
            <Field label="센서 유형">
              <select className={inputCls} value={f.sensor_type} onChange={(e) => set("sensor_type", e.target.value)}>
                {SENSOR_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="단위 (unit)">
              <input className={inputCls} value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="예: celsius / percent / ppm" required />
            </Field>
            <Field label="소속 생육기 device_id (선택)">
              <input className={inputCls} value={f.parent_device_id} onChange={(e) => set("parent_device_id", e.target.value)} placeholder="예: growbed-01" />
            </Field>
          </>
        )}
        {t === "tank" && (
          <>
            <Field label="탱크 유형">
              <select className={inputCls} value={f.tank_type} onChange={(e) => set("tank_type", e.target.value)}>
                {TANK_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="용량 (L)">
              <input type="number" className={inputCls} value={f.capacity_l} onChange={(e) => set("capacity_l", e.target.value)} placeholder="예: 500" required />
            </Field>
          </>
        )}
        {t === "station" && (
          <Field label="스테이션 유형">
            <select className={inputCls} value={f.station_type} onChange={(e) => set("station_type", e.target.value)}>
              {STATION_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        )}
        {t === "actuator" && (
          <>
            <Field label="제어 명령">
              <select className={inputCls} value={f.command} onChange={(e) => set("command", e.target.value)}>
                {ACTUATOR_COMMANDS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="결합 센서 sensor_id (선택)">
              <input className={inputCls} value={f.affects_sensor_id} onChange={(e) => set("affects_sensor_id", e.target.value)} placeholder="예: temp-a" />
            </Field>
            <Field label="작동 부하 kW (선택)">
              <input type="number" className={inputCls} value={f.power_kw} onChange={(e) => set("power_kw", e.target.value)} placeholder="예: 1.2" />
            </Field>
          </>
        )}
        {err && <p className="text-12.5 font-bold text-status-warningDark">{err}</p>}
        <Actions onCancel={onClose} submitLabel={edit ? "수정" : "추가"} busy={busy} />
      </form>
    </Modal>
  );
}

// ── 삭제 확인 ──
function ConfirmModal({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="삭제 확인" onClose={onCancel}>
      <p className="text-13.5 font-semibold text-gray-700">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-13 font-bold text-gray-500">취소</button>
        <button
          disabled={busy}
          onClick={async () => { setBusy(true); await onConfirm(); }}
          className="rounded-lg bg-status-warning px-4 py-2 text-13 font-extrabold text-white disabled:opacity-50"
        >
          {busy ? "삭제 중…" : "삭제"}
        </button>
      </div>
    </Modal>
  );
}

// ── 팜별 장치 관리 ──
function FarmDevices({ farmId }: { farmId: string }) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [registering, setRegistering] = useState<DeviceRow | null>(null);
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [deleting, setDeleting] = useState<DeviceRow | null>(null);

  const reload = useCallback(() => {
    void listDevices(farmId, { includeUnregistered: true }).then(setDevices);
  }, [farmId]);
  useEffect(reload, [reload]);

  const registered = devices.filter((d) => d.registered);
  // 미등록은 종류별로 섞지 않고 따로 모은다 — 설비 대장이 아니라 「화면에 떠
  // 있는데 등록되지 않은 것」이라는 사실 자체가 봐야 할 정보다.
  const unregistered = devices.filter((d) => !d.registered);
  const grouped = DEVICE_TYPES.map((dt) => ({
    type: dt, rows: registered.filter((d) => d.device_type === dt.value),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-13 font-bold text-gray-600">장치 {registered.length}대</span>
        <button onClick={() => setAdding(true)} className="rounded-lg bg-primary-bg px-3 py-1 text-12.5 font-extrabold text-primary-dark">+ 장치 추가</button>
      </div>
      {grouped.length === 0 && <p className="py-2 text-12.5 font-semibold text-muted">등록된 장치가 없습니다.</p>}
      {grouped.map((g) => (
        <div key={g.type.value} className="mb-2">
          <div className="mb-1 text-11.5 font-extrabold uppercase tracking-wide text-muted">{g.type.label}</div>
          {g.rows.map((d) => (
            <div key={d.device_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 basis-full text-13 font-bold sm:basis-auto">
                {d.name} <span className="font-semibold text-muted">· {d.device_id}</span>
                {d.location && <span className="font-semibold text-muted"> · {d.location}</span>}
              </span>
              <button onClick={() => setEditing(d)} className="rounded-md px-2 py-1 text-12 font-bold text-gray-500 hover:bg-gray-100">수정</button>
              <button onClick={() => setDeleting(d)} className="rounded-md px-2 py-1 text-12 font-bold text-status-warningDark hover:bg-gray-100">삭제</button>
            </div>
          ))}
        </div>
      ))}
      {unregistered.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-11.5 font-extrabold uppercase tracking-wide text-status-warningDark">
            미등록 · 데이터만 들어옴
          </div>
          <p className="mb-1 text-11.5 font-semibold text-muted">
            데이터는 들어오는데 대장에 없는 장치입니다. 등록하기 전에는 운영 화면에
            나오지 않습니다. 이 농장의 장비가 아니라면 그대로 두세요.
          </p>
          {unregistered.map((d) => (
            <div key={d.device_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 basis-full text-13 font-bold sm:basis-auto">
                {d.device_id}
                <span className="font-semibold text-muted"> · {DEVICE_TYPE_LABEL[d.device_type] ?? d.device_type}</span>
                {/* 지금 발행 중인 장치와 오래전에 사라진 흔적이 같이 모인다 */}
                <span className="font-semibold text-muted"> · {timeAgo(d.last_seen ?? null, { withTime: true })}</span>
              </span>
              <button onClick={() => setRegistering(d)} className="rounded-md px-2 py-1 text-12 font-bold text-primary-dark hover:bg-gray-100">등록</button>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <DeviceModal
          farmId={farmId} candidates={unregistered}
          onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }}
        />
      )}
      {registering && (
        <DeviceModal
          farmId={farmId} candidates={unregistered} preset={registering}
          onClose={() => setRegistering(null)} onDone={() => { setRegistering(null); reload(); }}
        />
      )}
      {editing && <DeviceModal farmId={farmId} edit={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {deleting && (
        <ConfirmModal
          message={`'${deleting.name}' (${deleting.device_id}) 장치를 삭제할까요? (소프트 삭제)`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await deleteDevice(farmId, deleting.device_id); setDeleting(null); reload(); }}
        />
      )}
    </div>
  );
}

// ── 발견 섹션 ──
function DiscoverySection({ onRegistered }: { onRegistered: () => void }) {
  const [farms, setFarms] = useState<DiscoveredFarm[]>([]);
  const [target, setTarget] = useState<DiscoveredFarm | null>(null);

  const reload = useCallback(() => listDiscovery().then(setFarms, () => {}), []);
  useVisiblePolling(reload, 5000);   // 발견은 실시간성 있음 — 주기 갱신

  const openRegister = (farm: DiscoveredFarm) => setTarget(farm);

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-16 font-extrabold">발견된 스마트팜</h2>
      <p className="mb-3 text-12.5 font-semibold text-muted">
        미들웨어에 등록되지 않았지만 데이터가 들어오고 있는 팜입니다. 등록하면 장치·센서까지 자동으로 함께 등록됩니다.
      </p>
      {farms.length === 0 ? (
        <div className="rounded-2xl bg-white p-5 text-13 font-semibold text-muted shadow-sm">발견된 미등록 팜이 없습니다.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {farms.map((f) => (
            <div key={f.farm_id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-status-caution" />
                <span className="text-15 font-extrabold">{f.farm_id}</span>
                <button onClick={() => openRegister(f)} className="ml-auto shrink-0 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-12.5 font-extrabold text-white">등록</button>
              </div>
              <div className="mt-2 text-12.5 font-semibold text-muted">장치 {f.device_count}대 · 센서 {f.sensor_count}종 발견</div>
              <div className="mt-1 text-12 font-medium text-muted">
                {f.devices.map((d) => `${DEVICE_TYPE_LABEL[d.device_type] ?? d.device_type}:${d.device_id}`).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {target && (
        <FarmModal
          discovered={target}
          onClose={() => setTarget(null)}
          onDone={() => { setTarget(null); reload(); onRegistered(); }}
        />
      )}
    </section>
  );
}

/**
 * 요소를 본문 맨 위로 올린다. 고정 헤더·정지 배너 높이는 배너 유무·글자 크기로 변해
 * 상수로 둘 수 없어 실측한다 (AppShell 의 data-app-chrome).
 */
// 페인트 전에 끝내야 옮겨가는 모습이 보이지 않는다 (SSR 경고는 피한다)
const useAlignEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function alignToTop(el: HTMLElement) {
  const chrome = document.querySelector<HTMLElement>("[data-app-chrome]");
  window.scrollTo({
    top: el.getBoundingClientRect().top + window.scrollY - (chrome?.offsetHeight ?? 0) - 12,
  });
}

// ── 메인 ──
// useSearchParams 는 정적 렌더에서 Suspense 경계를 요구한다 — 없으면 next build 실패
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const user = useUser();
  // 농장 목록은 공유 컨텍스트에서 — 화면마다 따로 조회하지 않는다
  const { farms, refreshFarms, reloadWeather } = useFarmData();
  // 알림 규칙은 농장 전부를 한 번에 읽어 각 AlertRules 에 넘긴다 — 컴포넌트가 각자
  // 조회하면 화면 진입 때 농장 수만큼 요청이 나간다.
  const [rulesByFarm, setRulesByFarm] = useState<Record<string, AlertRuleRow[]>>({});
  const farmIdsKey = farms.map((f) => f.farm_id).join(",");
  useEffect(() => {
    if (!farmIdsKey) return;
    void listAlertRules(farmIdsKey.split(",")).then(setRulesByFarm);
  }, [farmIdsKey]);
  // 「?farm=…&section=devices|rules」로 들어오면 그 농장의 해당 절을 화면 위로 올린다.
  // 진입 시점에 한 번만 읽는다 — 아래에서 주소를 지우므로 매 렌더 읽으면 값이 바뀐다
  const router = useRouter();
  const params = useSearchParams();
  const [focus] = useState(() => ({
    farm: params.get("farm"),
    section: params.get("section") === "rules" ? "rules" : "devices",
    requested: params.has("farm") || params.has("section"),
  }));
  // 여러 농장을 동시에 펼친다 — 하나만 열리면 다른 농장을 열 때 위쪽이 접히며 화면이
  // 튀고, 두 농장의 장치를 나란히 비교할 수도 없다
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(focus.section === "devices" && focus.farm ? [focus.farm] : []),
  );
  const deviceRef = useRef<HTMLDivElement>(null);
  const rulesRef = useRef<HTMLDivElement>(null);
  const rulesSectionRef = useRef<HTMLElement>(null);
  const [addingFarm, setAddingFarm] = useState(false);
  const [editingFarm, setEditingFarm] = useState<FarmSummary | null>(null);
  const [deletingFarm, setDeletingFarm] = useState<FarmSummary | null>(null);

  useAlignEffect(() => {
    if (!focus.requested || !farms.length) return;
    // 농장을 지정하면 그 농장의 블록, 안 하면(전역 알림에서 옴) 절 머리로
    const el = focus.section !== "rules" ? deviceRef.current
      : focus.farm ? rulesRef.current
      : rulesSectionRef.current;
    if (!el) {
      window.scrollTo({ top: 0 });   // 이동 측이 scroll:false 라 방치하면 엉뚱한 위치
      return;
    }
    alignToTop(el);

    // 알림 규칙은 페이지 맨 아래인데 각 블록이 규칙을 받아오기 전에는 비어 있다.
    // 첫 렌더에는 문서가 짧아 목표까지 스크롤이 잘리므로, 높이가 자리 잡을 때까지
    // 다시 맞춘다. 사용자가 스크롤하면 즉시 멈춘다 — 조작을 되돌리면 안 된다.
    const observer = new ResizeObserver(() => alignToTop(el));
    observer.observe(document.body);
    const stop = () => observer.disconnect();
    const timer = setTimeout(stop, 1200);
    window.addEventListener("wheel", stop, { once: true, passive: true });
    window.addEventListener("touchstart", stop, { once: true, passive: true });

    // 일회성 의도이지 화면 상태가 아니다 — 남기면 새로고침마다 다시 끌려간다
    router.replace("/settings", { scroll: false });

    return () => {
      stop();
      clearTimeout(timer);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
    };
  }, [focus, farms.length, router]);

  const toggleDevices = (farmId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(farmId)) next.add(farmId);
      return next;
    });

  const reloadFarms = useCallback(() => {
    void refreshFarms();
  }, [refreshFarms]);

  // 미들웨어가 저장 응답 전에 날씨를 받아두므로 한 번만 다시 읽으면 된다
  const refreshAfterFarmSave = useCallback(() => {
    void refreshFarms();
    void reloadWeather();
  }, [refreshFarms, reloadWeather]);

  // 접근 게이트 — viewer 차단 (실제 강제는 api). user 로드 후 판정.
  useEffect(() => {
    if (user && !canControl(user)) location.href = "/forbidden";
  }, [user]);

  if (user && !canControl(user)) return null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-22 font-extrabold">설정</h1>
        <span className="text-13 font-semibold text-muted">
          계정·권한 / 농장·설비 관리 / 알림 규칙
        </span>
      </div>

      {/* 계정 · 권한 (디자인 설정 화면 첫 섹션) */}
      <section className="mb-8">
        <h2 className="mb-3 text-16 font-extrabold">계정 · 권한</h2>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          {user ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-bg text-16 font-extrabold text-primary-dark">
                {user.name.slice(0, 1)}
              </span>
              <span>
                <span className="block text-14.5 font-extrabold">{user.name}</span>
                <span className="block text-12.5 font-semibold text-muted">{user.email}</span>
              </span>
              <span className="rounded-lg bg-primary-bg px-2.5 py-1 text-12 font-extrabold text-primary-dark">
                {ROLE_LABEL[user.role]}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="text-12.5 font-bold text-gray-400">2단계 인증 · 원격 접근 설정</span>
                <PlannedChip basis="FR-31 · OPN-07" />
              </span>
            </div>
          ) : (
            <div className="text-13 font-semibold text-muted">계정 정보를 불러오는 중…</div>
          )}
        </div>
      </section>

      <DiscoverySection onRegistered={refreshAfterFarmSave} />

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-16 font-extrabold">등록된 스마트팜</h2>
          <button onClick={() => setAddingFarm(true)} className="ml-auto rounded-xl border border-dashed border-gray-300 px-4 py-2 text-13 font-extrabold text-primary-dark">
            + 스마트팜 추가
          </button>
        </div>
        {farms.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-13 font-semibold text-muted shadow-sm">등록된 팜이 없습니다.</div>
        ) : (
          farms.map((f) => (
            <div
              key={f.farm_id}
              ref={f.farm_id === focus.farm ? deviceRef : undefined}
              className="mb-3 rounded-2xl bg-white p-4 shadow-sm"
            >
              {/* 큰글씨에서 한 줄에 못 담으면 줄바꿈 — 눌러 담으면 메타 문구가 세로로 읽힌다.
                  조작 버튼 3개는 한 덩어리로 묶어 함께 내려간다 (흩어지면 짝을 잃는다) */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-15 font-extrabold">{f.name}</span>
                <span className="rounded-md bg-primary-bg px-1.5 py-0.5 text-11 font-bold text-primary-dark">{f.farm_id}</span>
                <span className="text-12.5 font-semibold text-muted">{farmTypeLabel(f.farm_type)} · {f.crop ?? "—"} · {f.devices_online}/{f.devices_total} 온라인</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                <button onClick={() => toggleDevices(f.farm_id)} className="whitespace-nowrap rounded-md px-2 py-1 text-12.5 font-bold text-gray-500 hover:bg-gray-100">
                  {expanded.has(f.farm_id) ? "접기" : "장치 관리"}
                </button>
                <button onClick={() => setEditingFarm(f)} className="rounded-md px-2 py-1 text-12.5 font-bold text-gray-500 hover:bg-gray-100">수정</button>
                <button onClick={() => setDeletingFarm(f)} className="rounded-md px-2 py-1 text-12.5 font-bold text-status-warningDark hover:bg-gray-100">삭제</button>
                </span>
              </div>
              {expanded.has(f.farm_id) && <FarmDevices farmId={f.farm_id} />}
            </div>
          ))
        )}
      </section>

      {/* 알림 규칙 (FR-34) — 디자인 설정 화면의 알림 섹션 */}
      <section ref={rulesSectionRef} className="mt-8">
        <h2 className="mb-3 text-16 font-extrabold">알림 규칙</h2>
        {farms.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-13 font-semibold text-muted shadow-sm">
            팜을 먼저 등록하세요.
          </div>
        ) : (
          farms.map((f) => (
            <div
              key={f.farm_id}
              ref={f.farm_id === focus.farm ? rulesRef : undefined}
              className="mb-3"
            >
              <div className="mb-1.5 text-13 font-extrabold text-gray-600">{f.name}</div>
              <AlertRules editable={canControl(user)} rules={rulesByFarm[f.farm_id] ?? NO_RULES} />
            </div>
          ))
        )}
      </section>

      {addingFarm && <FarmModal onClose={() => setAddingFarm(false)} onDone={() => { setAddingFarm(false); refreshAfterFarmSave(); }} />}
      {editingFarm && <FarmModal edit={editingFarm} onClose={() => setEditingFarm(null)} onDone={() => { setEditingFarm(null); refreshAfterFarmSave(); }} />}
      {deletingFarm && (
        <ConfirmModal
          message={`'${deletingFarm.name}' (${deletingFarm.farm_id}) 팜을 비활성화할까요? 목록에서 숨겨집니다. (소프트 삭제)`}
          onCancel={() => setDeletingFarm(null)}
          onConfirm={async () => { await deleteFarm(deletingFarm.farm_id); setDeletingFarm(null); reloadFarms(); }}
        />
      )}
    </main>
  );
}
