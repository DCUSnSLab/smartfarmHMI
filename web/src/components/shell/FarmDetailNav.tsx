"use client";

/**
 * 농장 상세 화면 탭 네비게이션.
 * 농장 상세 화면에서 농장 범위 전환 네비게이션 바로 아래에 공통으로 표시한다.
 * 상태 / 생육기·센서 / 로봇 / 작업·공급 / 알림 화면으로 이동한다.
 * 현재 선택된 탭을 활성화하고, 선택된 농장 경로를 유지한다.
 */

import { usePathname } from "next/navigation";
import { useFarmData } from "@/lib/farmData";
import { NavDropdown, NavItemData, NavItemLink } from "@/components/ui";


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

  const badge = (seg: string) =>
    seg === "alerts" && unacked > 0 ? (
      <span className="shrink-0 rounded-full bg-status-warning px-1.5 text-11 font-extrabold text-white">
        {unacked}
      </span>
    ) : undefined;

  // 넓은 폭의 탭 나열과 좁은 폭의 드롭다운이 같은 목록을 쓴다
  const items: NavItemData[] = TABS.map((tab) => ({
    key: tab.seg,
    href: `/farms/${farmId}/${tab.seg}`,
    label: tab.label,
    active: currentTab === tab.seg,
    trail: badge(tab.seg),
  }));

  return (
    <nav className="w-full border-b border-gray-200 bg-white">
      {/* 좁은 폭에서는 접는다 — 탭 5종이 두 줄이 되면 밑줄이 두 겹으로 보여
          어느 것이 현재 탭인지 흐려지고, 고정 영역 높이도 그만큼 커진다 */}
      <NavDropdown items={items} ariaLabel="상세 화면 선택" className="mx-auto max-w-7xl sm:hidden" />

      <div className="mx-auto hidden max-w-7xl flex-wrap gap-1 px-6 sm:flex">
        {items.map((item) => (
          <NavItemLink
            key={item.key}
            item={item}
            className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-[3px] px-3.5 py-3 text-13.5 focus:outline-none ${
              item.active
                ? "border-primary font-extrabold text-primary-dark"
                : "border-transparent font-semibold text-gray-500 hover:text-primary-dark"
            }`}
          >
            {item.label}
            {item.trail}
          </NavItemLink>
        ))}
      </div>
    </nav>
  );
}