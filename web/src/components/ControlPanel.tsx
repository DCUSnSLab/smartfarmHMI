"use client";

/**
 * 생육기 수동제어 (FR-10) — 디자인 전달본 farm-env 「환경 제어」 카드 참조.
 * 제어 대상 4종: 온도·습도·양분(EC)·LED. 환기·차광·천창은 범위 밖.
 * 명령 상태를 접수/완료 구분해 표시한다 (비기능 §4 — "보낸 것"≠"실행된 것").
 */

import { useState } from "react";
import { CommandState, postControl, timeAgo } from "@/lib/monitor";

const CONTROLS = [
  { command: "set_temperature", label: "목표 온도", unit: "℃", min: 18, max: 30, step: 0.5, init: 25 },
  { command: "set_humidity", label: "목표 습도", unit: "%", min: 40, max: 80, step: 1, init: 60 },
  { command: "set_ec", label: "양분(EC)", unit: "", min: 0.5, max: 3, step: 0.1, init: 1.8 },
  { command: "set_led", label: "LED 밝기", unit: "%", min: 0, max: 100, step: 5, init: 70 },
] as const;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  issued: { text: "접수 대기", cls: "bg-gray-100 text-gray-600" },
  accepted: { text: "접수됨 · 실행 중", cls: "bg-status-info/10 text-status-infoDark" },
  completed: { text: "완료", cls: "bg-primary-bg text-primary-dark" },
  failed: { text: "실패", cls: "bg-status-warning/10 text-status-warningDark" },
  rejected: { text: "거부됨", cls: "bg-status-warning/10 text-status-warningDark" },
  timeout: { text: "응답 없음 (타임아웃)", cls: "bg-status-warning/10 text-status-warningDark" },
};

const CMD_LABEL: Record<string, string> = {
  set_temperature: "온도", set_humidity: "습도", set_ec: "EC", set_led: "LED",
  set_auto_mode: "자동 모드",
};

export function ControlPanel({
  farmId, deviceId, commands, disabled, disabledReason,
}: {
  farmId: string;
  deviceId: string;
  commands: Record<string, CommandState>;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(CONTROLS.map((c) => [c.command, c.init])),
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const apply = async () => {
    setSending(true);
    for (const cmd of dirty) {
      await postControl(farmId, deviceId, cmd, values[cmd]);
    }
    setDirty(new Set());
    setSending(false);
  };

  const recent = Object.values(commands)
    .sort((a, b) => (b.issued_at ?? "").localeCompare(a.issued_at ?? ""))
    .slice(0, 5);

  return (
    <section id="control" className="mb-6">
      <h3 className="mb-3 text-15 font-extrabold">
        환경 제어 <span className="font-semibold text-muted">· 수동 · 온도·습도·양분·LED</span>
      </h3>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ── 설정 (디자인: 슬라이더 + 적용) ── */}
        <div className={`rounded-2xl bg-white p-5 shadow-sm ${disabled ? "opacity-60" : ""}`}>
          {CONTROLS.map((c) => (
            <div key={c.command} className="mb-4 last:mb-0">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-13 font-bold text-gray-600">{c.label}</span>
                <span className="text-17 font-extrabold">
                  {values[c.command]}<span className="text-12 text-muted">{c.unit}</span>
                  {dirty.has(c.command) && <span className="ml-1 text-11 font-bold text-status-cautionDark">변경됨</span>}
                </span>
              </div>
              <input
                type="range" min={c.min} max={c.max} step={c.step}
                value={values[c.command]} disabled={disabled}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [c.command]: Number(e.target.value) }));
                  setDirty((s) => new Set(s).add(c.command));
                }}
                className="h-2 w-full cursor-pointer accent-[#00A05A]"
              />
            </div>
          ))}
          <button
            onClick={apply}
            disabled={disabled || sending || dirty.size === 0}
            className="mt-2 w-full rounded-xl bg-primary py-3 text-15 font-extrabold text-white disabled:bg-gray-200 disabled:text-gray-400"
          >
            {sending ? "전송 중…" : `설정 적용${dirty.size ? ` (${dirty.size}건)` : ""}`}
          </button>
          {disabled && disabledReason && (
            <p className="mt-2 text-center text-12 font-semibold text-status-warningDark">
              {disabledReason}
            </p>
          )}
        </div>

        {/* ── 명령 이력 (접수/완료 구분) ── */}
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-2 text-13 font-bold text-gray-600">최근 명령</div>
          {recent.length === 0 && (
            <div className="py-6 text-center text-13 font-semibold text-muted">아직 보낸 명령이 없어요</div>
          )}
          {recent.map((c) => (
            <div key={c.command_id} className="flex items-center justify-between border-b border-gray-100 py-2.5 text-13.5 last:border-0">
              <span className="font-bold">
                {CMD_LABEL[c.command ?? ""] ?? c.command}
                {c.params?.target != null && <span className="text-muted"> → {String(c.params.target)}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-11.5 font-semibold text-muted">{timeAgo(c.issued_at ?? null)}</span>
                <span className={`rounded-lg px-2 py-0.5 text-12 font-extrabold ${STATUS_LABEL[c.status]?.cls ?? ""}`}>
                  {STATUS_LABEL[c.status]?.text ?? c.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
