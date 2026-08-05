"use client";

/**
 * 통합 대시보드 농장 범위 전환 네비게이션.
 * 통합 대시보드와 농장 상세 화면에서 헤더 바로 아래에 공통으로 표시한다.
 * 현재 선택된 전체 또는 농장 버튼을 활성화하고, 농장 변경 시 현재 상세 탭을 유지한다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useFarmData } from "@/lib/farmData";
import { farmSeverity, useFleetSnapshots } from "@/lib/fleet";
import { SEV_STYLE } from "@/components/ui";

export function FarmScopeNav() {
  const pathname = usePathname();
  const { farms } = useFarmData();

  // 대시보드 '농장별 현황' 카드와 동일한 상태색을 쓰기 위해 스냅샷(통신)과
  // 미확인 경고 알림을 함께 반영한다. 공유 alerts 는 선택 스코프에 따라 좁혀지므로,
  // 네비는 전 농장 알림을 독립적으로 폴링해 클릭과 무관하게 유지한다.
  const snaps = useFleetSnapshots(farms.map((f) => f.farm_id));

  const [warnByFarm, setWarnByFarm] = useState<Record<string, number>>({});
  useEffect(() => {
    const load = async () => {
      const r = await apiFetch("/api/alerts?limit=100");
      if (!r.ok) return;
      const list: { farm_id?: string; severity: string; acked_at: string | null }[] = await r.json();
      const counts: Record<string, number> = {};
      for (const a of list) {
        if (a.acked_at || a.severity !== "warning" || !a.farm_id) continue;
        counts[a.farm_id] = (counts[a.farm_id] ?? 0) + 1;
      }
      setWarnByFarm(counts);
    };
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

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
          className={`rounded-full border px-4 py-2 text-13 ${
            isDashboard
              ? "border-primary bg-primary font-extrabold text-white"
              : "border-gray-200 bg-white font-bold text-gray-600"
          }`}
        >
          전체
        </Link>

        {farms.map((farm) => {
          const active = currentFarmId === farm.farm_id;
          const snap = snaps[farm.farm_id];
          const sev = snap ? farmSeverity(snap, warnByFarm[farm.farm_id] ?? 0) : "info";

          return (
              <Link
                  key={farm.farm_id}
                  href={`/farms/${farm.farm_id}/${currentTab}`}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-13 focus:outline-none ${
                      active
                          ? "border-primary bg-primary font-extrabold text-white"
                          : "border-gray-200 bg-white font-bold text-gray-600 hover:border-primary hover:text-primary-dark"
                  }`}
              >

                <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${SEV_STYLE[sev]?.dot}`}/>

                <span>{farm.name}</span>

                {farm.farm_type === "open_field" && (
                    <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-10.5 font-extrabold text-blue-600">
                  실외
                </span>
                )}
              </Link>
          );
        })}
      </div>
    </nav>
  );
}