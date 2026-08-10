"use client";

/**
 * 전역 상단 네비게이션 (디자인 전달본 "전역 상단 네비게이션 — 모든 화면 고정").
 * 좌: 로고 + 네비 5종 / 우(항상 고정): 사용자 메뉴 · 알림 · 원격 전체 정지
 *
 * 좁은 폭에서는 네비를 햄버거 드로어로 접는다 (비기능 §5). 접는 시점은 상수가 아니라
 * 실측 — 큰글씨 3단계가 rem 여백을, max-w-7xl 이 컨테이너 폭을 함께 확대하므로
 * 뷰포트 px 과 실제 여유 폭의 관계가 단계마다 달라진다.
 *
 * 알림·원격 전체 정지는 어떤 폭에서도 접지 않는다 — 안전 조작이라 1탭 거리를 유지한다.
 * 실시간 연결 표시는 각 화면 본문에 있어 헤더에서는 뺐다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertPanel } from "@/components/AlertPanel";
import { StopButton, StopRelease } from "@/components/StopControls";
import { CONTROL, CONTROL_ICON, useAnchoredPanel, useLightDismiss } from "@/components/ui";
import { AuthUser, ROLE_LABEL, canControl, logout, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { LEVEL_LABEL, useFontLevel } from "@/lib/prefs";

const EXPAND_MARGIN = 24;  // 되펼칠 때 요구하는 여유 폭(px) — 경계 깜빡임 방지
const FIT_SLACK = 4;       // 넘치기 전에 접도록 두는 여유(px)

/**
 * 압축 단계 — 폭이 모자랄 때 **이 순서로 하나씩** 줄인다.
 * 잃는 정보가 적은 것부터: 네비는 드로어로 옮겨도 접근 가능하고, 사용자 이름·정지
 * 라벨은 아이콘·축약으로 남는다. 여백 압축은 마지막 (더 줄일 게 없을 때).
 */
const STAGE = { nav: 1, user: 2, stop: 3, gap: 4 } as const;
const MAX_STAGE = STAGE.gap;

/** 자식 폭 합산으로 필요 폭을 구한다 — scrollWidth 는 넘치기 전엔 여유를 알려주지 않는다 */
function neededWidth(row: HTMLElement): number {
  const cs = getComputedStyle(row);
  const gap = parseFloat(cs.columnGap) || 0;
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const kids = Array.from(row.children) as HTMLElement[];
  const sum = kids.reduce((s, el) => s + el.getBoundingClientRect().width, 0);
  return sum + gap * Math.max(0, kids.length - 1) + pad;
}

// 압축 판정은 페인트 전에 끝내야 한다 — useEffect 로 하면 초기화된(펼쳐진) 상태가
// 한 프레임 보여 글자 크기를 바꿀 때마다 깜빡인다. SSR 경고는 피한다.
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface NavItem {
  href: string;
  label: string;
  match?: (p: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "통합 대시보드", match: (p) => p === "/" || p.startsWith("/farms") },
  { href: "/stats", label: "통계·분석" },
  { href: "/journal", label: "농업일지" },
  { href: "/settings", label: "설정" },
  { href: "/support", label: "지원" },
];

const isActive = (n: NavItem, pathname: string) =>
  n.match ? n.match(pathname) : pathname.startsWith(n.href);

/** 가 큰글씨 3단계 (비기능 §5) — 사용자 메뉴 안에 둔다 */
function FontControl() {
  const { level, inc, dec } = useFontLevel();
  return (
    <span className="flex items-center justify-between gap-1 rounded-xl border border-gray-200 px-2 py-1.5">
      <span className="px-1 text-12.5 font-extrabold text-gray-600">가</span>
      <button
        onClick={dec} disabled={level === 0} aria-label="글자 작게"
        className="h-7 w-7 rounded-lg bg-gray-50 text-14 font-extrabold text-gray-600 disabled:opacity-40"
      >−</button>
      <span className="min-w-[3.5rem] text-center text-11.5 font-bold text-muted">
        {LEVEL_LABEL[level]}
      </span>
      <button
        onClick={inc} disabled={level === 2} aria-label="글자 크게"
        className="h-7 w-7 rounded-lg bg-gray-50 text-14 font-extrabold text-gray-600 disabled:opacity-40"
      >+</button>
    </span>
  );
}

function UserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="5.4" r="3.2" />
      <path d="M9 10c-3.5 0-6.3 2.2-6.3 5 0 .3.2.5.5.5h11.6c.3 0 .5-.2.5-.5 0-2.8-2.8-5-6.3-5Z" />
    </svg>
  );
}

/** 사용자 메뉴 — 계정 정보 · 글자 크기 · 로그아웃. 외부 클릭·Esc 로 닫는다 */
function UserMenu({ user, compact }: { user: AuthUser; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const { anchorRef, style, unplaced } = useAnchoredPanel(open, 260);
  useLightDismiss(open, anchorRef, () => setOpen(false));

  return (
    <span ref={anchorRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-label={`${user.name} 계정 메뉴`} aria-expanded={open}
        className={
          compact
            ? `${CONTROL_ICON} border border-gray-200 bg-white text-gray-600`
            : `${CONTROL} gap-1.5 border border-gray-200 bg-white px-3 font-bold text-gray-600`
        }
      >
        <UserIcon />
        {!compact && user.name}
      </button>

      {open && (
        <span
          style={style}
          className={`absolute top-[calc(100%+0.375rem)] z-50 flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-lg ring-1 ring-gray-100 ${
            unplaced ? "invisible" : ""
          }`}
        >
          <span className="block">
            <span className="block text-14 font-extrabold">{user.name}</span>
            <span className="block text-12 font-semibold text-muted">{user.email}</span>
          </span>
          <span className="w-fit rounded-md bg-primary-bg px-2 py-0.5 text-11.5 font-extrabold text-primary-dark">
            {ROLE_LABEL[user.role]}
          </span>

          <span className="mt-1 border-t border-gray-100 pt-3">
            <span className="mb-1.5 block text-11.5 font-bold text-muted">글자 크기</span>
            <FontControl />
          </span>

          <button
            onClick={logout}
            className="mt-1 rounded-xl border border-gray-200 py-2.5 text-13 font-bold text-gray-500"
          >
            로그아웃
          </button>
        </span>
      )}
    </span>
  );
}

/** 접힌 네비 — 좌측 오프캔버스. 외부 클릭·Esc 로 닫는다 */
function NavDrawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const [shown, setShown] = useState(false);  // 마운트 후 켜서 슬라이드 인

  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose}>
      <nav
        aria-label="주요 메뉴"
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-[min(280px,80vw)] flex-col gap-1 bg-white p-4 shadow-xl transition-transform duration-200 ${
          shown ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {NAV.map((n) => (
          <Link
            key={n.href} href={n.href} onClick={onClose}
            className={`rounded-xl px-3 py-3 text-14.5 ${
              isActive(n, pathname)
                ? "bg-primary-bg font-extrabold text-primary-dark"
                : "font-semibold text-gray-600"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const user = useUser();
  const { stops, globalAlerts } = useFarmData();
  const { level } = useFontLevel();
  const [stage, setStage] = useState(0);          // 압축 단계 (0=전체 … MAX_STAGE)
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const stageAt = useRef<number[]>([]);           // 각 단계에서의 필요 폭 — 되펼칠 기준

  // 단계별로 하나씩 줄인다 — 한 트리거로 여러 요소를 동시에 줄이면 여백이 남는데도
  // 갑자기 축소된 것처럼 보인다
  const collapsed = stage >= STAGE.nav;
  const compactUser = stage >= STAGE.user;
  const shortStop = stage >= STAGE.stop;
  const tight = stage >= STAGE.gap;

  // 되펼침 판정이 컨테이너 폭 기준이라, 폭이 그대로인 채 콘텐츠만 좁아지는 경우
  // (글자 크기 축소, 정지 배너 발동으로 버튼 사라짐 등)에는 스스로 풀리지 않는다.
  // 그래서 그런 변화에는 압축을 초기화하고 아래 measure 가 다시 판정하게 한다.
  useMeasureEffect(() => {
    setStage(0);
  }, [level, user, stops.remote]);

  // 넘치면 한 단계 올리고, 직전 단계의 필요 폭 + 여유가 확보되면 한 단계 내린다.
  // 한 번의 measure 에서 한 단계만 움직인다 — stage 가 바뀌면 이 훅이 다시 돌며 수렴한다.
  useMeasureEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      const avail = row.clientWidth;
      const need = neededWidth(row);
      if (need > avail - FIT_SLACK) {
        if (stage < MAX_STAGE) {
          stageAt.current[stage] = need;   // 이 단계의 필요 폭을 기억
          setStage(stage + 1);
        }
        return;
      }
      // 되펼침은 직전 단계가 실제로 들어갈 폭이 됐을 때만 — 경계에서 깜빡이지 않게.
      // 기록이 없으면(있을 수 없지만) 되돌리지 않는다 — 0 으로 두면 즉시 되돌아 진동한다
      if (stage > 0 && avail > (stageAt.current[stage - 1] ?? Infinity) + EXPAND_MARGIN) {
        setStage(stage - 1);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [stage, level, user, stops.remote]);

  // 폭이 넓어지면 닫는다 — 드로어가 열린 채 데스크톱 레이아웃으로 돌아가는 것 방지
  useEffect(() => {
    if (!collapsed) setMenuOpen(false);
  }, [collapsed]);

  return (
    <>
      {/* flex-wrap 없음 — 넘칠 때 줄바꿈이 아니라 STAGE 순서로 접는다.
          모든 컨트롤이 같은 높이(CONTROL)라 단계와 무관하게 행 높이가 같다.
          고정은 AppShell 의 sticky 컨테이너가 맡는다 — 정지 배너와 함께 묶여야
          스크롤 시 배너가 이 바를 덮지 않는다 */}
      <header className="border-b border-gray-100 bg-white/95 backdrop-blur">
        <div
          ref={rowRef}
          className={`mx-auto flex max-w-7xl items-center py-2 ${
            tight ? "gap-1.5 px-3" : "gap-3 px-6"
          }`}
        >
          {collapsed && (
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="메뉴 열기" aria-expanded={menuOpen}
              className={`${CONTROL_ICON} -ml-2 text-gray-600 hover:bg-gray-50`}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  d="M2 4.5h14M2 9h14M2 13.5h14"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                />
              </svg>
            </button>
          )}

          {/* 로고는 shrink-0 — 줄어들면 neededWidth 가 자식의 실제 폭 합이라 부족분을
              로고가 흡수해 버리고, 그러면 다음 압축 단계가 승격되지 않는다 (「팜온」만
              뭉개진 채 사용자·정지 라벨은 그대로). 폭 확보는 STAGE 가 순서대로 맡는다.
              마지막 단계에서 텍스트만 감추고 아이콘은 남긴다 */}
          <Link href="/" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-white">
              {/* 새싹 — 디자인 전달본(.dc.html) 원본 path */}
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 21v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path
                  d="M12 13c0-4.5 3.2-7.5 7.5-7.5 0 4.5-3.2 7.5-7.5 7.5z"
                  stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
                />
                <path
                  d="M12 13c0-3.4-2.4-5.6-6-5.6 0 3.4 2.4 5.6 6 5.6z"
                  stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className={`text-16 font-extrabold ${tight ? "hidden" : ""}`}>팜온</span>
          </Link>

          {!collapsed && (
            <nav className="flex shrink-0 gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href} href={n.href}
                  className={`${CONTROL} px-3 ${
                    isActive(n, pathname)
                      ? "bg-primary-bg font-extrabold text-primary-dark"
                      : "font-semibold text-gray-500"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}

          {/* 우측 고정 영역 — shrink-0 로 글자 단위 찌그러짐을 막는다 */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {user && <UserMenu user={user} compact={compactUser} />}

            {/* 알림 — 전역 벨 (스코프 무관: 전체 알림) */}
            <AlertPanel key={pathname} farmId={null} alerts={globalAlerts} />

            {/* 정지 자리 — 발동 중에는 같은 자리가 해제로 바뀐다 (자리를 비우지 않는다).
                배너에 해제를 두면 정지 중 우측 구성이 무너지고 폭 정렬도 어긋난다 */}
            {stops.remote
              ? <StopRelease
                  canRelease={canControl(user)}
                  estopActive={!!stops.physical_estop}
                  short={shortStop}
                />
              : <StopButton canStop={canControl(user)} short={shortStop} />}
          </div>
        </div>
      </header>

      {/* header 의 backdrop-blur 가 fixed 의 컨테이닝 블록이 되므로 밖에서 렌더한다 */}
      {collapsed && menuOpen && (
        <NavDrawer pathname={pathname} onClose={() => setMenuOpen(false)} />
      )}
    </>
  );
}
