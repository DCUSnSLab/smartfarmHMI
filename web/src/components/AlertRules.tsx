"use client";

/**
 * 알림 규칙 설정 (FR-34) — 센서 항목별 상·하한 임계값 + On/Off.
 * admin/manager 만 수정 가능. 기본값은 잠정 (OPN-20).
 */

import { useEffect, useState } from "react";

interface Rule {
  id: number;
  alert_kind: string;
  sensor_type: string | null;
  min_value: number | null;
  max_value: number | null;
  enabled: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  temperature: "온도 (℃)", humidity: "습도 (%)", ec: "양분 EC", co2: "CO₂ (ppm)",
  illuminance: "조도 (klx)", power: "전력 (kW)",
};

export function AlertRules({ farmId, editable }: { farmId: string; editable: boolean }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/farms/${farmId}/alert-rules`).then(async (r) => r.ok && setRules(await r.json()));
  }, [farmId]);

  const save = async (rule: Rule) => {
    const res = await fetch(`/api/alert-rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        min_value: rule.min_value, max_value: rule.max_value, enabled: rule.enabled,
      }),
    });
    if (res.ok) {
      setSaved(rule.id);
      setTimeout(() => setSaved(null), 1500);
    }
  };

  const set = (id: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  if (rules.length === 0) return null;

  return (
    <section id="rules" className="mb-6">
      <h3 className="mb-3 text-[15px] font-extrabold">
        알림 규칙 <span className="font-semibold text-muted">· 임계값 기본값은 잠정 (OPN-20)</span>
      </h3>
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-gray-50 py-2.5 last:border-0">
            <span className="w-28 text-[13.5px] font-bold">
              {TYPE_LABEL[r.sensor_type ?? ""] ?? r.sensor_type}
            </span>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600">
              하한
              <input
                type="number" value={r.min_value ?? ""} disabled={!editable}
                onChange={(e) => set(r.id, { min_value: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-[13px] font-bold disabled:bg-gray-50"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600">
              상한
              <input
                type="number" value={r.max_value ?? ""} disabled={!editable}
                onChange={(e) => set(r.id, { max_value: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-[13px] font-bold disabled:bg-gray-50"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] font-bold">
              <input
                type="checkbox" checked={r.enabled} disabled={!editable}
                onChange={(e) => set(r.id, { enabled: e.target.checked })}
                className="h-4 w-4 accent-[#00A05A]"
              />
              사용
            </label>
            {editable && (
              <button
                onClick={() => void save(r)}
                className="rounded-lg bg-primary-bg px-3 py-1 text-[12.5px] font-extrabold text-primary-dark"
              >
                {saved === r.id ? "저장됨 ✓" : "저장"}
              </button>
            )}
          </div>
        ))}
        {!editable && (
          <p className="pt-2 text-[12px] font-semibold text-muted">조회 전용 계정 — 규칙 수정 권한이 없습니다</p>
        )}
      </div>
    </section>
  );
}
