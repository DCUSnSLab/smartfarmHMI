"use client";

/**
 * 농장 상세 셸 — 농장명·통신 상태만 둔다.
 * 스코프 스위처와 탭 바는 전역 셸(AppShell)의 FarmScopeNav·FarmDetailNav 로 이관했다.
 */

import { useEffect } from "react";
import { useParams, usePathname } from "next/navigation";
import { StatusDot } from "@/components/ui";
import { useFarmData, useScope } from "@/lib/farmData";

export default function FarmLayout({ children }: { children: React.ReactNode }) {
  const { farmId } = useParams<{ farmId: string }>();
  useScope(farmId);

  // 탭·농장을 바꾸면 화면 맨 위에서 시작한다. 내려서 보던 자리가 그대로 남으면
  // 새 화면의 첫 카드를 지나친 채 열리고, 어디로 왔는지 알기 어렵다
  const pathname = usePathname();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const { farmName, conns } = useFarmData();

  const edge = Object.values(conns).find((c) => c.device_id.startsWith("edge"));

  return (
    <div className="mx-auto max-w-7xl px-6 py-5">
      {/* 농장 헤더 */}
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-20 font-extrabold">{farmName || farmId}</h1>
        <StatusDot
          sev={edge?.state === "online" ? "ok" : edge?.state === "degraded" ? "caution" : "warning"}
          label={edge?.state === "online" ? "정상 가동" : edge?.state === "degraded" ? "응답 지연" : "통신 단절"}
        />
      </div>

      {children}
    </div>
  );
}
