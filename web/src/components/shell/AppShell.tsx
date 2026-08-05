"use client";

/**
 * 앱 셸 — 헤더·정지 배너·어시스턴트를 전 화면에 고정한다 (디자인 전역 요소).
 * login/forbidden 은 셸 없이 단독 표시.
 */

import { usePathname } from "next/navigation";
import { Assistant } from "@/components/shell/Assistant";
import { FarmDetailNav } from "@/components/shell/FarmDetailNav";
import { FarmScopeNav } from "@/components/shell/FarmScopeNav";
import { Header } from "@/components/shell/Header";
import { StopBanners } from "@/components/StopControls";
import { FarmDataProvider, useFarmData } from "@/lib/farmData";
import { PrefsProvider } from "@/lib/prefs";

const BARE_PATHS = ["/login", "/forbidden"];

function Chrome({ children }: { children: React.ReactNode }) {
  const { stops, farms } = useFarmData();
  return (
    <>
      {/* 배너와 헤더를 한 sticky 컨테이너에 둔다. 각각 sticky top-0 이면 스크롤 시
          배너가 헤더를 덮어 네비를 가린다 — 정지 중에는 네비를 쓸 수 없게 된다.
          순서는 전달본과 같이 배너가 위 (design-change-spec §1) */}
      <div className="sticky top-0 z-50">
        <StopBanners stops={stops} farms={farms} />
        <Header />
      </div>

      {/* 스코프 스위처·탭 바는 고정하지 않는다 — 정지 배너까지 고정되는 상황에서
          함께 묶으면 좁은 화면의 본문이 거의 남지 않는다 (GEN-1231) */}
      <FarmScopeNav />
      <FarmDetailNav />
      {children}
      <Assistant />
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_PATHS.some((p) => pathname.startsWith(p))) return <>{children}</>;

  return (
    <PrefsProvider>
      <FarmDataProvider>
        <Chrome>{children}</Chrome>
      </FarmDataProvider>
    </PrefsProvider>
  );
}
