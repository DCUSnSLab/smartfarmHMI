"use client";

/**
 * 알림 규칙 설정 (FR-34) — 센서 항목별 상·하한 임계값 + On/Off.
 * admin/manager 만 수정 가능. 기본값은 잠정 (OPN-20).
 */

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AlertRuleRow as Rule } from "@/lib/settings";

const TYPE_LABEL: Record<string, string> = {
  temperature: "온도 (℃)", humidity: "습도 (%)", ec: "양분 EC", co2: "CO₂ (ppm)",
  illuminance: "조도 (klx)", power: "전력 (kW)",
};

/**
 * rules 는 부모가 묶음 조회로 받아 넘긴다 — 농장마다 이 컴포넌트가 각자 조회하면
 * 설정 화면 진입 때 농장 수만큼 요청이 나간다 (lib/settings.ts 의 listAlertRules).
 * 편집은 지역 상태로 처리하므로 초기값만 받아 심는다.
 */
export function AlertRules(
  { editable, rules: initial }: { editable: boolean; rules: Rule[] },
) {
  const [rules, setRules] = useState<Rule[]>(initial);
  const [saved, setSaved] = useState<number | null>(null);
  // 저장 표시를 지우는 타이머 — 연달아 저장하거나 화면을 떠나도 남지 않게 잡아 둔다
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // 부모가 다시 읽어 오면(농장 추가·삭제) 그 값으로 갈아탄다
  useEffect(() => setRules(initial), [initial]);

  const save = async (rule: Rule) => {
    const res = await apiFetch(`/api/alert-rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        min_value: rule.min_value, max_value: rule.max_value, enabled: rule.enabled,
      }),
    });
    if (res.ok) {
      setSaved(rule.id);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(null), 1500);
    }
  };

  const set = (id: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  if (rules.length === 0) return null;

  return (
    <section id="rules" className="mb-6">
      <h3 className="mb-3 text-15 font-extrabold">
        알림 규칙 <span className="font-semibold text-muted">· 임계값 기본값은 잠정 (OPN-20)</span>
      </h3>
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        {rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-gray-50 py-2.5 last:border-0">
            <span className="w-28 text-13.5 font-bold">
              {TYPE_LABEL[r.sensor_type ?? ""] ?? r.sensor_type}
            </span>
            <label className="flex items-center gap-1.5 text-12.5 font-semibold text-gray-600">
              하한
              <input
                type="number" value={r.min_value ?? ""} disabled={!editable}
                onChange={(e) => set(r.id, { min_value: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-13 font-bold disabled:bg-gray-50"
              />
            </label>
            <label className="flex items-center gap-1.5 text-12.5 font-semibold text-gray-600">
              상한
              <input
                type="number" value={r.max_value ?? ""} disabled={!editable}
                onChange={(e) => set(r.id, { max_value: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-13 font-bold disabled:bg-gray-50"
              />
            </label>
            <label className="flex items-center gap-1.5 text-12.5 font-bold">
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
                className="rounded-lg bg-primary-bg px-3 py-1 text-12.5 font-extrabold text-primary-dark"
              >
                {saved === r.id ? "저장됨 ✓" : "저장"}
              </button>
            )}
          </div>
        ))}
        {!editable && (
          <p className="pt-2 text-12 font-semibold text-muted">조회 전용 계정 — 규칙 수정 권한이 없습니다</p>
        )}
      </div>
    </section>
  );
}
