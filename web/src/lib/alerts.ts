/**
 * 알림 목록 페이지 상태 (FR-33) — 서버 페이지네이션 + 실시간 겹쳐 그리기.
 *
 * 왜 FarmDataProvider 의 alerts 를 그대로 쓰지 않는가:
 * 그 맵은 헤더 벨·대시보드 KPI·농장 네비 배지가 함께 보는 **최신 N건 창**이다.
 * 거기에 페이지 개념을 넣으면 "미확인 48건"이 "미확인 3건"으로 바뀐다. 그래서
 * 목록 화면만 자기 조회를 갖고, 공유 맵은 건드리지 않는다.
 *
 * 실시간과 페이지 번호를 어떻게 같이 두는가:
 *   · 목록을 연 시점을 기준선(anchor)으로 고정한다 — 페이지를 넘기는 동안 새
 *     알림이 도착해도 페이지 내용이 밀리지 않는다 (offset 페이지의 고질병).
 *   · 새로 도착한 알림은 목록에 끼어들지 않고 「새 알림 N건」으로 알린다. 공유
 *     맵에서 기준선보다 최신인 것을 세므로 서버를 다시 부르지 않아도 늘어난다.
 *   · 읽음 처리는 즉시 반영한다 — 같은 id 가 공유 맵에 있으면 그 값으로 대체.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AlertItem, AlertPageResponse } from "@/lib/monitor";
import { useFarmData } from "@/lib/farmData";

/** 한 페이지 건수 */
const ALERT_PAGE_SIZE = 20;
/** 페이지 번호를 한 번에 몇 개 보여줄지 — ‹ › 의 이동 폭도 이 값을 쓴다. */
export const ALERT_PAGE_WINDOW = 5;

export interface AlertPageState {
  items: AlertItem[];
  /** 필터를 적용한 전체 건수 (기준선 이하) */
  total: number;
  /** 미확인 총계 — 심각도 필터와 무관하다 */
  unacked: number;
  page: number;
  pages: number;
  goToPage: (n: number) => void;
  filter: string;
  setFilter: (f: string) => void;
  /** 기준선보다 새로 도착한 알림 수 — 0 이면 표시하지 않는다 */
  newer: number;
  /** 기준선을 지금으로 다시 잡고 1페이지부터 읽는다 (새 알림 편입·일괄 읽음 후) */
  refresh: () => void;
  loading: boolean;
}

function listPath(scope: string, params: URLSearchParams): string {
  return scope === "all"
    ? `/api/alerts?${params}`
    : `/api/farms/${scope}/alerts?${params}`;
}

/** 기준선 "<occurred_at ISO>|<id>" 을 비교 가능한 형태로 나눈다. */
function parseAnchor(anchor: string | null | undefined): { at: number; id: number } | null {
  if (!anchor) return null;
  const cut = anchor.lastIndexOf("|");
  if (cut < 0) return null;
  const at = Date.parse(anchor.slice(0, cut));
  const id = Number(anchor.slice(cut + 1));
  return Number.isFinite(at) && Number.isFinite(id) ? { at, id } : null;
}

/**
 * 기준선보다 새로 도착한 알림인가.
 *
 * 커서 문자열끼리 비교하면 안 된다 — 같은 시각에 발생한 알림들 사이에서 id 가
 * 사전순으로 비교돼 뒤집힌다 ("…|99" > "…|337" 이 참이 된다). 시각은 숫자로,
 * 같은 시각이면 id 를 숫자로 비교한다. 밀리초 미만이 같으면 id 로 갈리는데,
 * id 는 삽입 순서로 증가하므로 새 알림이 항상 크다.
 */
function isNewer(a: AlertItem, key: { at: number; id: number }): boolean {
  const at = Date.parse(a.occurred_at);
  if (!Number.isFinite(at)) return false;
  return at !== key.at ? at > key.at : a.id > key.id;
}

/** scope: "all" | farmId */
export function useAlertPage(scope: string): AlertPageState {
  const { alerts: live } = useFarmData();
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AlertPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // 기준선은 ref 로 든다 — state 로 두면 응답에서 받아 넣는 순간 조회 effect 의
  // 의존성이 바뀌어 같은 요청이 한 번 더 나간다 (첫 응답이 이미 그 기준선으로
  // 만들어진 결과라 두 번째는 완전히 동일하다). 화면에 필요한 값은 응답의
  // data.anchor 로 충분하므로 렌더에 쓰이지 않는다.
  const anchorRef = useRef<string | null>(null);

  // 농장을 바꾸면 이전 농장의 기준선·페이지·필터는 의미가 없다. effect 로 되돌리면
  // 조회 effect 가 먼저 돌아 **옛 기준선으로 한 번 더** 요청이 나가므로, 렌더 중에
  // 맞춘다 (React 의 "prop 이 바뀔 때 state 조정" 패턴).
  const [shownScope, setShownScope] = useState(scope);
  if (shownScope !== scope) {
    setShownScope(scope);
    setPage(1);
    setFilter("all");
    setData(null);
    anchorRef.current = null;
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(ALERT_PAGE_SIZE),
      page: String(page),
    });
    if (filter !== "all") params.set("severity", filter);
    if (anchorRef.current) params.set("anchor", anchorRef.current);

    void apiFetch(listPath(scope, params))
      .then(async (r) => {
        if (!r.ok || !active) return;
        const res: AlertPageResponse = await r.json();
        setData(res);
        // 서버가 잡아 준 기준선을 이후 요청에 계속 되돌려 보낸다.
        if (anchorRef.current == null) anchorRef.current = res.anchor;
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [scope, filter, page, reloadKey]);

  const changeFilter = useCallback((f: string) => {
    setFilter(f);
    setPage(1);   // 필터를 바꾸면 페이지 수가 달라진다 — 처음부터
  }, []);

  const goToPage = useCallback((n: number) => setPage(Math.max(1, n)), []);

  const refresh = useCallback(() => {
    anchorRef.current = null;   // 기준선을 지금으로 다시 잡는다 → 새 알림이 편입
    setPage(1);
    setReloadKey((k) => k + 1);
  }, []);

  const { items, unacked, newer } = useMemo(() => {
    const base = data?.items ?? [];
    // 읽음 처리를 즉시 반영 (WS 로 갱신된 공유 맵 값이 우선).
    const merged = base.map((a) => live[a.id] ?? a);

    // 기준선보다 새로 도착한 것 — 목록에는 넣지 않고 건수만 알린다.
    const key = parseAnchor(data?.anchor);
    const newerCount = key
      ? Object.values(live).filter(
        (a) => (scope === "all" || a.farm_id === scope) && isNewer(a, key),
      ).length
      : 0;

    // 서버 집계에 화면에서 관측한 읽음을 반영한다. 목록 밖은 알 수 없으므로 여기서
    // 세는 것은 「내가 방금 읽은 것」뿐이다 — 일괄 읽음은 refresh() 가 담당한다.
    const ackedSinceLoad = base.filter((a) => !a.acked_at && live[a.id]?.acked_at).length;

    return {
      items: merged,
      unacked: Math.max(0, (data?.unacked_total ?? 0) - ackedSinceLoad),
      newer: newerCount,
    };
  }, [data, live, scope]);

  return {
    items,
    total: data?.total ?? 0,
    unacked,
    // 서버가 마지막 페이지로 접어 돌려주므로 표시는 응답 값을 따른다 — page state 를
    // 되맞추면 같은 페이지를 한 번 더 요청하게 된다.
    page: data?.page ?? page,
    pages: data?.pages ?? 1,
    goToPage,
    filter,
    setFilter: changeFilter,
    newer,
    refresh,
    loading,
  };
}

/**
 * 페이지 번호 목록 — 현재 페이지가 속한 그룹 (ALERT_PAGE_WINDOW 개 단위).
 * 예: 폭 5, pages=23, page=14 → [11..15]
 */
export function pageWindow(page: number, pages: number): number[] {
  const start = Math.floor((page - 1) / ALERT_PAGE_WINDOW) * ALERT_PAGE_WINDOW + 1;
  const end = Math.min(start + ALERT_PAGE_WINDOW - 1, pages);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => start + i);
}
