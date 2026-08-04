"use client";

/**
 * 설정 · 농장·설비 관리 (FR-07·13·38) — admin/manager 전용.
 * 두 경로: (1) 발견된 스마트팜 등록, (2) 팜·장치 직접 추가/수정/삭제.
 * 데이터 CRUD 는 /lib/settings 헬퍼(→ api → middleware). 게이팅은 api 가 강제, 여기선 보조.
 */

import { AlertRules } from "@/components/AlertRules";
import { PlannedChip } from "@/components/Planned";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ROLE_LABEL, canControl, useUser } from "@/lib/auth";
import { FarmSummary } from "@/lib/monitor";
import {
  ACTUATOR_COMMANDS, DEVICE_TYPES, DEVICE_TYPE_LABEL, DeviceRow, DiscoveredFarm,
  FARM_TYPES, SENSOR_TYPES, STATION_TYPES, TANK_TYPES,
  createDevice, createFarm, deleteDevice, deleteFarm, listDevices, listDiscovery,
  registerDiscovered, updateDevice, updateFarm,
} from "@/lib/settings";

const farmTypeLabel = (t: string) => FARM_TYPES.find((f) => f.value === t)?.label ?? t;

// ── 공용 모달 ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-16 font-extrabold">{title}</h3>
        {children}
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
  edit, onClose, onDone,
}: {
  edit?: FarmSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [farmId, setFarmId] = useState(edit?.farm_id ?? "");
  const [name, setName] = useState(edit?.name ?? "");
  const [farmType, setFarmType] = useState(edit?.farm_type ?? "greenhouse");
  const [crop, setCrop] = useState(edit?.crop ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const ok = edit
      ? await updateFarm(edit.farm_id, { name, farm_type: farmType, crop: crop || null })
      : await createFarm({ farm_id: farmId.trim(), name, farm_type: farmType, crop: crop || null });
    setBusy(false);
    if (ok) onDone();
    else setErr("저장에 실패했습니다. 입력값(특히 farm_id 중복)을 확인하세요.");
  };

  return (
    <Modal title={edit ? `팜 수정 · ${edit.farm_id}` : "스마트팜 추가"} onClose={onClose}>
      <form onSubmit={submit}>
        {!edit && (
          <Field label="farm_id (자연키 · MQTT 토픽 · 이후 변경 불가)">
            <input className={inputCls} value={farmId} onChange={(e) => setFarmId(e.target.value)} placeholder="예: gimje" required />
          </Field>
        )}
        <Field label="농장 이름">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 김제 벼 논" required />
        </Field>
        <Field label="유형">
          <select className={inputCls} value={farmType} onChange={(e) => setFarmType(e.target.value)}>
            {FARM_TYPES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
        <Field label="작물 (선택)">
          <input className={inputCls} value={crop} onChange={(e) => setCrop(e.target.value)} placeholder="예: 벼" />
        </Field>
        {err && <p className="text-12.5 font-bold text-status-warningDark">{err}</p>}
        <Actions onCancel={onClose} submitLabel={edit ? "수정" : "추가"} busy={busy} />
      </form>
    </Modal>
  );
}

// ── 장치 추가/수정 모달 (유형별 상세 필드) ──
function DeviceModal({
  farmId, edit, onClose, onDone,
}: {
  farmId: string;
  edit?: DeviceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState<Record<string, string>>(() => ({
    device_id: edit?.device_id ?? "",
    device_type: edit?.device_type ?? "growbed",
    name: edit?.name ?? "",
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
            <Field label="장치 유형">
              <select className={inputCls} value={t} onChange={(e) => set("device_type", e.target.value)}>
                {DEVICE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label={t === "sensor" ? "sensor_id (MQTT 식별자)" : "device_id (MQTT 식별자)"}>
              <input className={inputCls} value={f.device_id} onChange={(e) => set("device_id", e.target.value)} placeholder="예: temp-b / growbed-02" required />
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
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [deleting, setDeleting] = useState<DeviceRow | null>(null);

  const reload = useCallback(() => { void listDevices(farmId).then(setDevices); }, [farmId]);
  useEffect(reload, [reload]);

  const grouped = DEVICE_TYPES.map((dt) => ({
    type: dt, rows: devices.filter((d) => d.device_type === dt.value),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-13 font-bold text-gray-600">장치 {devices.length}대</span>
        <button onClick={() => setAdding(true)} className="rounded-lg bg-primary-bg px-3 py-1 text-12.5 font-extrabold text-primary-dark">+ 장치 추가</button>
      </div>
      {grouped.length === 0 && <p className="py-2 text-12.5 font-semibold text-muted">등록된 장치가 없습니다.</p>}
      {grouped.map((g) => (
        <div key={g.type.value} className="mb-2">
          <div className="mb-1 text-11.5 font-extrabold uppercase tracking-wide text-muted">{g.type.label}</div>
          {g.rows.map((d) => (
            <div key={d.device_id} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
              <span className="flex-1 text-13 font-bold">
                {d.name} <span className="font-semibold text-muted">· {d.device_id}</span>
                {d.location && <span className="font-semibold text-muted"> · {d.location}</span>}
              </span>
              <button onClick={() => setEditing(d)} className="rounded-md px-2 py-1 text-12 font-bold text-gray-500 hover:bg-gray-100">수정</button>
              <button onClick={() => setDeleting(d)} className="rounded-md px-2 py-1 text-12 font-bold text-status-warningDark hover:bg-gray-100">삭제</button>
            </div>
          ))}
        </div>
      ))}
      {adding && <DeviceModal farmId={farmId} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
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
  const [name, setName] = useState("");
  const [farmType, setFarmType] = useState("greenhouse");
  const [crop, setCrop] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => { void listDiscovery().then(setFarms); }, []);
  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000); // 발견은 실시간성 있음 — 주기 갱신
    return () => clearInterval(id);
  }, [reload]);

  const openRegister = (f: DiscoveredFarm) => { setTarget(f); setName(f.farm_id); setFarmType("greenhouse"); setCrop(""); };

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
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-status-caution" />
                <span className="text-15 font-extrabold">{f.farm_id}</span>
                <button onClick={() => openRegister(f)} className="ml-auto rounded-lg bg-primary px-3 py-1.5 text-12.5 font-extrabold text-white">등록</button>
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
        <Modal title={`발견된 팜 등록 · ${target.farm_id}`} onClose={() => setTarget(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const ok = await registerDiscovered(target.farm_id, { name, farm_type: farmType, crop: crop || null });
              setBusy(false);
              if (ok) { setTarget(null); reload(); onRegistered(); }
            }}
          >
            <p className="mb-3 text-12.5 font-semibold text-muted">
              장치 {target.device_count}대 · 센서 {target.sensor_count}종이 함께 등록됩니다.
            </p>
            <Field label="농장 이름">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="유형">
              <select className={inputCls} value={farmType} onChange={(e) => setFarmType(e.target.value)}>
                {FARM_TYPES.map((ft) => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
              </select>
            </Field>
            <Field label="작물 (선택)">
              <input className={inputCls} value={crop} onChange={(e) => setCrop(e.target.value)} />
            </Field>
            <Actions onCancel={() => setTarget(null)} submitLabel="등록" busy={busy} />
          </form>
        </Modal>
      )}
    </section>
  );
}

// ── 메인 ──
export default function SettingsPage() {
  const user = useUser();
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addingFarm, setAddingFarm] = useState(false);
  const [editingFarm, setEditingFarm] = useState<FarmSummary | null>(null);
  const [deletingFarm, setDeletingFarm] = useState<FarmSummary | null>(null);

  const reloadFarms = useCallback(() => {
    void apiFetch("/api/farms").then(async (r) => r.ok && setFarms(await r.json()));
  }, []);
  useEffect(reloadFarms, [reloadFarms]);

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

      <DiscoverySection onRegistered={reloadFarms} />

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
            <div key={f.farm_id} className="mb-3 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-15 font-extrabold">{f.name}</span>
                <span className="rounded-md bg-primary-bg px-1.5 py-0.5 text-11 font-bold text-primary-dark">{f.farm_id}</span>
                <span className="text-12.5 font-semibold text-muted">{farmTypeLabel(f.farm_type)} · {f.crop ?? "—"} · {f.devices_online}/{f.devices_total} 온라인</span>
                <button onClick={() => setExpanded(expanded === f.farm_id ? null : f.farm_id)} className="ml-auto rounded-md px-2 py-1 text-12.5 font-bold text-gray-500 hover:bg-gray-100">
                  {expanded === f.farm_id ? "접기" : "장치 관리"}
                </button>
                <button onClick={() => setEditingFarm(f)} className="rounded-md px-2 py-1 text-12.5 font-bold text-gray-500 hover:bg-gray-100">수정</button>
                <button onClick={() => setDeletingFarm(f)} className="rounded-md px-2 py-1 text-12.5 font-bold text-status-warningDark hover:bg-gray-100">삭제</button>
              </div>
              {expanded === f.farm_id && <FarmDevices farmId={f.farm_id} />}
            </div>
          ))
        )}
      </section>

      {/* 알림 규칙 (FR-34) — 디자인 설정 화면의 알림 섹션 */}
      <section className="mt-8">
        <h2 className="mb-3 text-16 font-extrabold">알림 규칙</h2>
        {farms.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-13 font-semibold text-muted shadow-sm">
            팜을 먼저 등록하세요.
          </div>
        ) : (
          farms.map((f) => (
            <div key={f.farm_id} className="mb-3">
              <div className="mb-1.5 text-13 font-extrabold text-gray-600">{f.name}</div>
              <AlertRules farmId={f.farm_id} editable={canControl(user)} />
            </div>
          ))
        )}
      </section>

      {addingFarm && <FarmModal onClose={() => setAddingFarm(false)} onDone={() => { setAddingFarm(false); reloadFarms(); }} />}
      {editingFarm && <FarmModal edit={editingFarm} onClose={() => setEditingFarm(null)} onDone={() => { setEditingFarm(null); reloadFarms(); }} />}
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
