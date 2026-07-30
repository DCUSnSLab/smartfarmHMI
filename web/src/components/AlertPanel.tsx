"use client";

/**
 * 알림 벨 + 패널 (FR-33) — 디자인 전달본 「전체 알림」 화면 참조:
 * 미확인 배지, 심각도 필터(전체/경고/주의/완료), 모두 읽음, 항목 클릭 → 관련 섹션 딥링크.
 */

import { useMemo, useState } from "react";
import { AlertItem, ackAlert, ackAllAlerts, timeAgo } from "@/lib/monitor";

const SEV: Record<string, { label: string; dot: string; text: string }> = {
  warning: { label: "경고", dot: "bg-status-warning", text: "text-status-warningDark" },
  caution: { label: "주의", dot: "bg-status-caution", text: "text-status-cautionDark" },
  info: { label: "완료", dot: "bg-status-ok", text: "text-primary-dark" },
};

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "warning", label: "경고" },
  { key: "caution", label: "주의" },
  { key: "info", label: "완료" },
] as const;

export function AlertPanel({ farmId, alerts }: { farmId: string; alerts: Record<number, AlertItem> }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const list = useMemo(
    () =>
      Object.values(alerts)
        .filter((a) => filter === "all" || a.severity === filter)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, 30),
    [alerts, filter],
  );
  const unacked = Object.values(alerts).filter((a) => !a.acked_at).length;

  const jump = (a: AlertItem) => {
    if (!a.acked_at) void ackAlert(a.id);
    if (a.deeplink?.startsWith("#")) {
      document.getElementById(a.deeplink.slice(1))?.scrollIntoView({ behavior: "smooth" });
      setOpen(false);
    }
  };

  return (
    <span className="relative">
      {/* 벨 버튼 + 미확인 배지 */}
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-bold text-gray-600"
        aria-label={`알림 ${unacked}건 미확인`}
      >
        알림
        {unacked > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-status-warning px-1 text-[11px] font-extrabold text-white">
            {unacked}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[380px] rounded-2xl bg-white p-4 shadow-lg ring-1 ring-gray-100">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[15px] font-extrabold">알림</span>
            <span className="text-[12px] font-bold text-muted">미확인 {unacked}건</span>
            <button
              onClick={() => void ackAllAlerts(farmId)}
              className="ml-auto text-[12px] font-bold text-primary-dark"
            >
              모두 읽음
            </button>
          </div>
          <div className="mb-2 flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${
                  filter === f.key ? "bg-primary-bg text-primary-dark" : "bg-gray-50 text-gray-500"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {list.length === 0 && (
              <div className="py-8 text-center text-[13px] font-semibold text-muted">알림이 없어요</div>
            )}
            {list.map((a) => (
              <button
                key={a.id}
                onClick={() => jump(a)}
                className={`block w-full border-b border-gray-50 px-1 py-2.5 text-left last:border-0 ${
                  a.acked_at ? "opacity-50" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 flex-none rounded-full ${SEV[a.severity].dot}`} />
                  <span className="flex-1 text-[13.5px] font-bold">{a.title}</span>
                  <span className={`text-[11px] font-extrabold ${SEV[a.severity].text}`}>
                    {SEV[a.severity].label}
                  </span>
                </span>
                <span className="mt-0.5 block pl-4 text-[12px] font-semibold text-muted">
                  {a.body} · {timeAgo(a.occurred_at)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
