"use client";

/**
 * 전역 상단 네비게이션 (디자인 전달본 "전역 상단 네비게이션 — 모든 화면 고정").
 * 좌: 로고 + 네비 5종 / 우(항상 고정): 가 큰글씨 · 알림 · 사용자·롤 · 원격 전체 정지
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertPanel } from "@/components/AlertPanel";
import { StopButton } from "@/components/StopControls";
import { ROLE_LABEL, canControl, logout, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { LEVEL_LABEL, useFontLevel } from "@/lib/prefs";

const NAV = [
  { href: "/", label: "통합 대시보드", match: (p: string) => p === "/" || p.startsWith("/farms") },
  { href: "/stats", label: "통계·분석" },
  { href: "/journal", label: "농업일지" },
  { href: "/settings", label: "설정" },
  { href: "/support", label: "지원" },
];

export function Header() {
  const pathname = usePathname();
  const user = useUser();
  const { level, inc, dec } = useFontLevel();
  const { scope, alerts, stops, wsOpen } = useFarmData();

  return (
    <header className="sticky top-0 z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-3">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-[15px] font-extrabold text-white">
            팜
          </span>
          <span className="text-[16px] font-extrabold">팜온</span>
        </Link>

        {/* 네비 */}
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => {
            const active = n.match ? n.match(pathname) : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-xl px-3 py-1.5 text-[13.5px] ${
                  active ? "bg-primary-bg font-extrabold text-primary-dark" : "font-semibold text-gray-500"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        {/* 우측 고정 영역 */}
        <div className="ml-auto flex items-center gap-2">
          {/* 가 큰글씨 3단계 (비기능 §5) */}
          <span className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-1">
            <span className="px-1 text-[12.5px] font-extrabold text-gray-600">가</span>
            <button
              onClick={dec} disabled={level === 0} aria-label="글자 작게"
              className="h-6 w-6 rounded-lg bg-gray-50 text-[13px] font-extrabold text-gray-600 disabled:opacity-40"
            >−</button>
            <span className="min-w-[3.5rem] text-center text-[11.5px] font-bold text-muted">
              {LEVEL_LABEL[level]}
            </span>
            <button
              onClick={inc} disabled={level === 2} aria-label="글자 크게"
              className="h-6 w-6 rounded-lg bg-gray-50 text-[13px] font-extrabold text-gray-600 disabled:opacity-40"
            >+</button>
          </span>

          <span className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-muted sm:flex">
            <span className={`h-2 w-2 rounded-full ${wsOpen ? "bg-status-ok" : "bg-status-warning"}`} />
            {wsOpen ? "실시간" : "연결 끊김"}
          </span>

          {/* 알림 — 전역 벨 (스코프 무관: 전체 알림) */}
          <AlertPanel farmId={scope === "all" ? null : scope} alerts={alerts} />

          {user && (
            <>
              <span className="rounded-xl bg-surface px-3 py-1.5 text-[12.5px] font-bold">
                {user.name}
                <span className="ml-1.5 rounded-md bg-primary-bg px-1.5 py-0.5 text-[11px] font-extrabold text-primary-dark">
                  {ROLE_LABEL[user.role]}
                </span>
              </span>
              <button
                onClick={logout}
                className="rounded-xl border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-bold text-gray-500"
              >
                로그아웃
              </button>
            </>
          )}

          {/* 원격 전체 정지 — 발동 중이면 배너의 해제 버튼으로 (중복 방지) */}
          {!stops.remote && <StopButton canStop={canControl(user)} />}
        </div>
      </div>
    </header>
  );
}
