"use client";

/**
 * 통합 대시보드 농장 범위 전환 네비게이션.
 * 통합 대시보드와 농장 상세 화면에서 헤더 바로 아래에 공통으로 표시한다.
 * 현재 선택된 전체 또는 농장 버튼을 활성화하고, 농장 변경 시 현재 상세 탭을 유지한다.
 */

import { usePathname } from "next/navigation";
import { useFarmData } from "@/lib/farmData";
import { farmStatus, showsFleetNav } from "@/lib/fleet";
import { NavItemData, ScopeBar, StatusMark } from "@/components/ui";

export function FarmScopeNav() {
  const pathname = usePathname();

  // 대시보드 카드·농장 상세 헤더와 같은 판정을 쓴다 (fleet.farmStatus).
  const { farms, snaps, stops } = useFarmData();

  const isDashboard = pathname === "/";
  const farmMatch = pathname.match(/^\/farms\/([^/]+)/);
  const currentFarmId = farmMatch?.[1];

  // 현재 보고 있는 상세 탭을 유지하면서 농장만 변경
  const tabMatch = pathname.match(/^\/farms\/[^/]+\/([^/]+)/);
  const currentTab = tabMatch?.[1] ?? "status";

  // 통합 대시보드와 농장 상세에서만 표시. 셸의 스냅샷 폴링 판정과 **같은 함수**를 쓴다 —
  // 조건을 따로 적으면 갈라져서, 폴링이 꺼진 화면에 네비가 뜨고 점이 빈 채로 남는다.
  if (!showsFleetNav(pathname)) {
    return null;
  }

  // 넓은 폭의 알약 나열과 좁은 폭의 드롭다운이 같은 목록을 써야 한다 — 각자 만들면
  // 한쪽에만 농장이 빠지거나 상태 점이 어긋난다
  const items: NavItemData[] = [
    // 「전체」에는 상태 점을 두지 않는다 — 특정 농장의 상태가 아니다
    { key: "all", href: "/", label: "전체", active: isDashboard },
    ...farms.map((farm) => {
      const snap = snaps[farm.farm_id];
      // 스냅샷 전에는 상태를 단정하지 않는다 — 파란 점을 두면 「정보」라는 상태처럼 읽힌다
      const status = snap ? farmStatus(snap, stops) : null;
      return {
        key: farm.farm_id,
        href: `/farms/${farm.farm_id}/${currentTab}`,
        label: farm.name,
        active: currentFarmId === farm.farm_id,
        lead: status
          ? <StatusMark sev={status.sev} label={`${status.label} · ${status.reasons.join(" · ")}`} />
          : <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-gray-200" />,
        trail: farm.farm_type === "open_field" ? (
          <span className="shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-10.5 font-extrabold text-blue-600">
            실외
          </span>
        ) : undefined,
      };
    }),
  ];

  // 좁은 폭에서는 접힌다 — 고정 영역이라 농장이 늘어난 만큼 본문이 밀린다 (ScopeBar)
  return <ScopeBar items={items} ariaLabel="농장 선택" />;
}
