"use client";

/**
 * 알림 벨 + 패널 (FR-33) — 디자인 전달본 「전체 알림」 화면 참조:
 * 미확인 배지, 심각도 필터(전체/경고/주의/완료), 모두 읽음, 항목 클릭 → 딥링크.
 *
 * farmId=null(전체 스코프)이면 모두 읽음은 감추고, 항목의 farm_id 로 경로를 만든다.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CONTROL_ICON, useAnchoredPanel, useLightDismiss } from "@/components/ui";
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

export function AlertPanel({
  farmId, alerts,
}: {
  farmId: string | null;
  alerts: Record<number, AlertItem>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const { anchorRef, style, unplaced } = useAnchoredPanel(open, 380);
  useLightDismiss(open, anchorRef, () => setOpen(false));

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
    setOpen(false);
    // deeplink 는 경로형(/farms/{farm}/{tab}) — 없으면 알림 목록으로
    if (a.deeplink?.startsWith("/")) router.push(a.deeplink);
    else router.push("/alerts");
  };

  return (
    <span ref={anchorRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`${CONTROL_ICON} relative border border-gray-200 bg-white text-gray-600`}
        aria-label={`알림 ${unacked}건 미확인`}
      >
        {/* 종 아이콘 — 디자인 전달본(.dc.html) 원본 path */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 9a6 6 0 1 1 12 0v3.8l1.4 2.7H4.6L6 12.8V9z"
            stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
          />
          <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {unacked > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-status-warning px-1 text-11 font-extrabold text-white">
            {unacked}
          </span>
        )}
      </button>

      {open && (
        <div
          style={style}
          className={`absolute top-[calc(100%+0.375rem)] z-50 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-gray-100 ${
            unplaced ? "invisible" : ""
          }`}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="text-15 font-extrabold">알림</span>
            <span className="text-12 font-bold text-muted">미확인 {unacked}건</span>
            <span className="ml-auto flex gap-2">
              {farmId && (
                <button
                  onClick={() => void ackAllAlerts(farmId)}
                  className="text-12 font-bold text-primary-dark"
                >
                  모두 읽음
                </button>
              )}
              <button
                onClick={() => { setOpen(false); router.push("/alerts"); }}
                className="text-12 font-bold text-gray-500"
              >
                전체 보기
              </button>
            </span>
          </div>
          <div className="mb-2 flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1 text-12 font-bold ${
                  filter === f.key ? "bg-primary-bg text-primary-dark" : "bg-gray-50 text-gray-500"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {list.length === 0 && (
              <div className="py-8 text-center text-13 font-semibold text-muted">알림이 없어요</div>
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
                  <span className="flex-1 text-13.5 font-bold">{a.title}</span>
                  <span className={`text-11 font-extrabold ${SEV[a.severity].text}`}>
                    {SEV[a.severity].label}
                  </span>
                </span>
                <span className="mt-0.5 block pl-4 text-12 font-semibold text-muted">
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

/** 알림 목록 (페이지형 — /alerts, 농장 알림 탭 공용) */
export function AlertList({
  alerts, farmId, showFarm = false,
}: {
  alerts: AlertItem[];
  farmId?: string | null;
  showFarm?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const list = alerts
    .filter((a) => filter === "all" || a.severity === filter)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const unacked = alerts.filter((a) => !a.acked_at).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-13 font-bold text-muted">미확인 {unacked}건</span>
        <span className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg px-2.5 py-1 text-12.5 font-bold ${
                filter === f.key ? "bg-primary-bg text-primary-dark" : "bg-white text-gray-500"
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
        {farmId && (
          <button
            onClick={() => void ackAllAlerts(farmId)}
            className="ml-auto rounded-lg bg-white px-3 py-1 text-12.5 font-bold text-primary-dark shadow-sm"
          >
            모두 읽음
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white p-2 shadow-sm">
        {list.length === 0 && (
          <div className="py-10 text-center text-13 font-semibold text-muted">알림이 없어요</div>
        )}
        {list.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              if (!a.acked_at) void ackAlert(a.id);
              if (a.deeplink?.startsWith("/")) router.push(a.deeplink);
            }}
            className={`flex w-full items-center gap-3 border-b border-gray-50 px-3 py-3 text-left last:border-0 ${
              a.acked_at ? "opacity-50" : ""
            }`}
          >
            <span className={`h-2.5 w-2.5 flex-none rounded-full ${SEV[a.severity].dot}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-14 font-bold">
                {showFarm && a.farm_id && (
                  <span className="mr-1.5 text-muted">{a.farm_id}</span>
                )}
                {a.title}
              </span>
              <span className="block text-12.5 font-semibold text-muted">{a.body}</span>
            </span>
            <span className="flex-none text-right">
              <span className={`block text-11.5 font-extrabold ${SEV[a.severity].text}`}>
                {SEV[a.severity].label}
              </span>
              <span className="block text-11.5 font-semibold text-muted">
                {timeAgo(a.occurred_at)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
