"use client";

/**
 * 농장 상세 화면 탭 네비게이션.
 * 농장 상세 화면에서 농장 범위 전환 네비게이션 바로 아래에 공통으로 표시한다.
 * 상태 / 생육기·센서 / 로봇 / 작업·공급 / 알림 화면으로 이동한다.
 * 현재 선택된 탭을 활성화하고, 선택된 농장 경로를 유지한다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFarmData } from "@/lib/farmData";

const TABS = [
  { seg: "status", label: "상태" },
  { seg: "env", label: "생육기·센서" },
  { seg: "robot", label: "로봇" },
  { seg: "supply", label: "작업·공급" },
  { seg: "alerts", label: "알림" },
];

export function FarmDetailNav() {
  const pathname = usePathname();
  const { alerts } = useFarmData();

  const farmMatch = pathname.match(
    /^\/farms\/([^/]+)(?:\/([^/]+))?/
  );

  // 농장 상세 화면이 아니면 표시하지 않음
  if (!farmMatch) {
    return null;
  }

  const farmId = farmMatch[1];
  const currentTab = farmMatch[2] ?? "status";

  const unacked = Object.values(alerts).filter(
    (alert) => alert.farm_id === farmId && !alert.acked_at
  ).length;

  return (
    <nav className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-1 px-6">
        {TABS.map((tab) => {
          const active = currentTab === tab.seg;

          return (
            <Link
              key={tab.seg}
              href={`/farms/${farmId}/${tab.seg}`}
              className={`-mb-px border-b-[3px] px-3.5 py-3 text-[13.5px] focus:outline-none ${
                active
                  ? "border-primary font-extrabold text-primary-dark"
                  : "border-transparent font-semibold text-gray-500 hover:text-primary-dark"
              }`}
            >
              {tab.label}

              {tab.seg === "alerts" && unacked > 0 && (
                <span className="ml-1.5 rounded-full bg-status-warning px-1.5 text-[11px] font-extrabold text-white">
                  {unacked}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>

  );
}