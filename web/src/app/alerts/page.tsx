"use client";

/**
 * 전역 알림 (디자인 "전역: 알림 (전체 농장)") — FR-33.
 * 전 농장 알림을 심각도 필터로 조회하고, 항목 클릭 시 관련 화면으로 딥링크.
 */

import Link from "next/link";
import { AlertList } from "@/components/AlertPanel";
import { useFarmData, useScope } from "@/lib/farmData";

export default function AlertsPage() {
  useScope("all");
  const { alerts } = useFarmData();
  const list = Object.values(alerts);
  const unacked = list.filter((a) => !a.acked_at).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-22 font-extrabold">알림</h1>
        <span className="text-13.5 font-bold text-status-warningDark">미확인 {unacked}건</span>
        <span className="text-13 font-semibold text-muted">
          전 농장 대상 · 각 알림을 누르면 관련 화면으로 이동해요
        </span>
        <Link href="/settings" className="ml-auto text-12.5 font-bold text-primary-dark">
          알림 규칙 설정 →
        </Link>
      </div>

      {/* 전체 스코프에서는 농장별 일괄 읽음이 불가 — 농장 알림 탭에서 수행 */}
      <AlertList alerts={list} showFarm />
    </main>
  );
}
