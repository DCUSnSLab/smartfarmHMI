"use client";

/**
 * 농장 상세 셸 — 농장명·통신 상태만 둔다.
 * 스코프 스위처와 탭 바는 전역 셸(AppShell)의 FarmScopeNav·FarmDetailNav 로 이관했다.
 */

import { useEffect } from "react";
import { useParams, usePathname } from "next/navigation";
import { SEV_STYLE, StatusMark } from "@/components/ui";
import { useFarmData, useScope } from "@/lib/farmData";
import { useFarmSnapshot } from "@/lib/farmDetail";
import { farmStatus } from "@/lib/fleet";

export default function FarmLayout({ children }: { children: React.ReactNode }) {
  const { farmId } = useParams<{ farmId: string }>();
  useScope(farmId);

  // 탭·농장을 바꾸면 화면 맨 위에서 시작한다 — 내려서 보던 자리가 남으면 새 화면의
  // 첫 카드를 지나친 채 열린다. 이 레이아웃은 밖으로 나가는 동안에도 잠시 살아 있어
  // 농장 상세 경로일 때만 적용한다 (아니면 떠나는 화면이 맨 위로 끌려간다).
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname.startsWith("/farms/")) return;
    window.scrollTo({ top: 0 });
  }, [pathname]);
  const { farmName, stops } = useFarmData();

  // 스코프 스위처·대시보드 카드와 **같은 함수·같은 스냅샷**을 쓴다. 예전에는 여기만
  // 엣지 연결 상태로 따로 판정해, 같은 농장인데 화면마다 점 색이 달랐다.
  const snap = useFarmSnapshot(farmId);
  const status = snap ? farmStatus(snap, stops) : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-5">
      {/* 농장 헤더 */}
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-20 font-extrabold">{farmName || farmId}</h1>
        {status && (
          <span className="inline-flex items-center gap-1.5 text-12.5 font-bold">
            <StatusMark sev={status.sev} label={status.label} />
            <span className={SEV_STYLE[status.sev].text}>{status.label}</span>
            {/* 헤더는 한 줄이라 첫 사유만 — 전체는 상태 탭의 요약 카드가 보여준다 */}
            <span className="font-semibold text-muted">
              {status.reasons[0]?.text}
              {status.reasons.length > 1 && ` 외 ${status.reasons.length - 1}건`}
            </span>
          </span>
        )}
      </div>

      {children}
    </div>
  );
}
