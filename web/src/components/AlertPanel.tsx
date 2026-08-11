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
import { ALERT_PAGE_WINDOW, AlertPageState, pageWindow } from "@/lib/alerts";
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
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
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
          <div className="max-h-64 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {list.length === 0 && (
              <div className="py-8 text-center text-13 font-semibold text-muted">알림이 없어요</div>
            )}
            {list.map((a) => (
              <button
                key={a.id}
                onClick={() => jump(a)}
                className={`block h-16 w-full border-b border-gray-50 px-1 py-2.5 text-left last:border-0 ${
                  a.acked_at ? "opacity-50" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 flex-none rounded-full ${SEV[a.severity].dot}`} />
                  <span className="min-w-0 flex-1 truncate text-13.5 font-bold">
                    {a.title}
                  </span>
                  <span className={`text-11 font-extrabold ${SEV[a.severity].text}`}>
                    {SEV[a.severity].label}
                  </span>
                </span>

                <span className="mt-0.5 block truncate pl-4 text-12 font-semibold text-muted">
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

/**
 * 알림 목록 (페이지형 — /alerts, 농장 알림 탭 공용).
 *
 * 목록·필터·건수는 `useAlertPage` 가 서버에서 받아온다 — 심각도 필터가 서버로
 * 가는 이유는, 받아온 창 안에서만 걸면 오래된 경고가 필터에 안 걸리기 때문이다.
 */
export function AlertList({
  page, farmId, showFarm = false,
}: {
  page: AlertPageState;
  farmId?: string | null;
  showFarm?: boolean;
}) {
  const router = useRouter();
  const { items: list, filter, setFilter, unacked, total, newer, loading } = page;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-13 font-bold text-muted">미확인 {unacked}건</span>
        {newer > 0 && (
          // 기준선 고정 때문에 새 알림은 목록에 끼어들지 않는다 — 여기서 알린다.
          <button
            onClick={page.refresh}
            className="rounded-lg bg-primary-bg px-2.5 py-1 text-12 font-extrabold text-primary-dark"
          >
            새 알림 {newer}건 · 새로고침
          </button>
        )}
        <span className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-12.5 font-bold ${
                filter === f.key ? "bg-primary-bg text-primary-dark" : "bg-white text-gray-500"
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
        {farmId && (
          <button
            // 대량 변경이라 겹쳐 그리기로는 목록 밖까지 반영되지 않는다 — 다시 읽는다.
            onClick={() => void ackAllAlerts(farmId).then(page.refresh)}
            className="ml-auto rounded-lg bg-white px-3 py-1 text-12.5 font-bold text-primary-dark shadow-sm"
          >
            모두 읽음
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-white p-2 shadow-sm">
        {list.length === 0 && (
          <div className="py-10 text-center text-13 font-semibold text-muted">
            {loading ? "불러오는 중…" : "알림이 없어요"}
          </div>
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

      {total > 0 && (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <Pager page={page} />
          <span className="text-11.5 font-semibold text-muted">총 {total}건</span>
        </div>
      )}
    </>
  );
}

/**
 * 페이지 이동 — « 처음 · ‹ N페이지 앞 · 번호 N개 · › N페이지 뒤 · » 마지막.
 * N = ALERT_PAGE_WINDOW (번호 개수와 ‹ › 이동 폭이 같은 값을 쓴다).
 *
 * ‹ › 는 N페이지가 온전히 남지 않아도 **남은 만큼 이동한다** (첫·마지막으로 접힘).
 * "다음 묶음이 있어야 활성"으로 두면 전체 페이지가 N 이하일 때 두 버튼이 늘 죽어
 * 있어, 눌러도 되는 상황인지 사용자가 판단하게 만든다.
 *
 * 좁은 폭 대응 — 번호 N개를 모든 폭에서 유지하고 **버튼을 32×32 정사각형**으로 둔다.
 *   · 폭을 줄이면서 높이를 그대로 두면 선택·hover 배경이 길죽한 직사각형이 된다.
 *     높이도 같이 줄여 정사각형을 유지한다 (9칸 = 304px, 375px 폭에 들어간다).
 *   · non-functional §5 의 「터치 영역 40px 이상」을 밑도는 값이다. 9칸을 375px 에
 *     넣으려면 칸당 34px 이하여야 해서 두 조건이 동시에 성립하지 않는다.
 *   · 넘칠 때는 줄바꿈이 아니라 가로 스크롤 — 2줄이 되면 마지막 줄에 화살표 두
 *     개만 남아 어디를 눌러야 할지 읽히지 않는다. 큰글씨 3단계에서는 버튼도 함께
 *     커지므로 어느 폭에서든 넘칠 수 있다.
 * 번호는 min-w 안에서 그려지므로 3자리(100)가 되어도 정사각형이 유지된다.
 */
function Pager({ page }: { page: AlertPageState }) {
  const { page: current, pages, goToPage, loading } = page;
  if (pages <= 1) return null;

  const numbers = pageWindow(current, pages);
  const step = (n: number) => goToPage(n);

  // 이동할 곳이 지금 페이지와 같을 때만 비활성 — 한 페이지라도 남았으면 누를 수 있다.
  const arrow = (label: string, aria: string, to: number) => (
    <button
      key={aria}
      onClick={() => step(to)}
      disabled={to === current || loading}
      aria-label={aria}
      // 화살표 글리프(« ‹ › »)는 같은 font-size 에서 숫자보다 작게 그려진다 —
      // 번호와 시각적 크기를 맞추려면 한 단계 이상 키워야 한다.
      className="flex h-8 min-w-8 flex-none items-center justify-center rounded-lg px-0.5 text-20 font-extrabold leading-none text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );

  return (
    <nav
      // flex-nowrap + 가로 스크롤: 어떤 폭·글자 크기에서도 2줄이 되지 않는다.
      className="flex max-w-full items-center justify-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="알림 페이지"
    >
      {arrow("«", "첫 페이지", 1)}
      {arrow(
        "‹", `${ALERT_PAGE_WINDOW}페이지 앞으로`,
        Math.max(1, current - ALERT_PAGE_WINDOW),
      )}
      {numbers.map((n) => (
        <button
          key={n}
          onClick={() => step(n)}
          disabled={loading}
          aria-current={n === current ? "page" : undefined}
          className={`flex h-8 min-w-8 flex-none items-center justify-center rounded-lg px-0.5 text-14 font-extrabold leading-none ${
            n === current
              ? "bg-primary text-white"
              : "text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          }`}
        >
          {n}
        </button>
      ))}
      {arrow(
        "›", `${ALERT_PAGE_WINDOW}페이지 뒤로`,
        Math.min(pages, current + ALERT_PAGE_WINDOW),
      )}
      {arrow("»", "마지막 페이지", pages)}
    </nav>
  );
}
