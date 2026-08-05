"use client";

/**
 * 농장 상세 셸 — 농장명·통신 상태만 둔다.
 * 스코프 스위처와 탭 바는 전역 셸(AppShell)의 FarmScopeNav·FarmDetailNav 로 이관했다.
 */

import { useParams } from "next/navigation";
import { StatusDot } from "@/components/ui";
import { useFarmData, useScope } from "@/lib/farmData";

export default function FarmLayout({ children }: { children: React.ReactNode }) {
  const { farmId } = useParams<{ farmId: string }>();
  useScope(farmId);
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
