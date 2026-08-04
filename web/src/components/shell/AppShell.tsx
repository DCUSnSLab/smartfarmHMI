"use client";

/**
 * 앱 셸 — 헤더·정지 배너·어시스턴트를 전 화면에 고정한다 (디자인 전역 요소).
 * login/forbidden 은 셸 없이 단독 표시.
 */

import { usePathname } from "next/navigation";
import { Assistant } from "@/components/shell/Assistant";
import { Header } from "@/components/shell/Header";
import { StopBanners } from "@/components/StopControls";
import { canControl, useUser } from "@/lib/auth";
import { FarmDataProvider, useFarmData } from "@/lib/farmData";
import { PrefsProvider } from "@/lib/prefs";
import { FarmScopeNav } from "@/components/shell/FarmScopeNav";

const BARE_PATHS = ["/login", "/forbidden"];

function Chrome({ children }: { children: React.ReactNode }) {
  const { stops } = useFarmData();
  const user = useUser();
  return (
    <>
      <Header />
      <StopBanners stops={stops} canRelease={canControl(user)} />

      <FarmScopeNav />
      
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
