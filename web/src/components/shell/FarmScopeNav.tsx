"use client";

/**
 * 통합 대시보드 농장 범위 전환 네비게이션.
 * 통합 대시보드와 농장 상세 화면에서 헤더 바로 아래에 공통으로 표시한다.
 * 현재 선택된 전체 또는 농장 버튼을 활성화하고, 농장 변경 시 현재 상세 탭을 유지한다.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFarmData } from "@/lib/farmData";

export function FarmScopeNav() {
  const pathname = usePathname();
  const { farms } = useFarmData();

  const isDashboard = pathname === "/";
  const farmMatch = pathname.match(/^\/farms\/([^/]+)/);
  const currentFarmId = farmMatch?.[1];

  // 현재 보고 있는 상세 탭을 유지하면서 농장만 변경
  const tabMatch = pathname.match(/^\/farms\/[^/]+\/([^/]+)/);
  const currentTab = tabMatch?.[1] ?? "status";

  // 통합 대시보드와 농장 상세에서만 표시
  if (!isDashboard && !currentFarmId) {
    return null;
  }

  return (
    <nav className="w-full border-b border-gray-100 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-6 py-2.5">
        <Link
          href="/"
          className={`rounded-full border px-4 py-2 text-[13px] ${
            isDashboard
              ? "border-primary bg-primary font-extrabold text-white"
              : "border-gray-200 bg-white font-bold text-gray-600"
          }`}
        >
          전체
        </Link>

        {farms.map((farm) => {
          const active = currentFarmId === farm.farm_id;

          return (
            <Link
              key={farm.farm_id}
              href={`/farms/${farm.farm_id}/${currentTab}`}
              className={`rounded-full border px-4 py-2 text-[13px] ${
                active
                  ? "border-primary bg-primary font-extrabold text-white"
                  : "border-gray-200 bg-white font-bold text-gray-600 hover:border-primary hover:text-primary-dark"
              }`}
            >
              {farm.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}