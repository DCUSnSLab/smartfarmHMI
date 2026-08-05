"use client";

/**
 * 농장 상세 셸 — 스코프 스위처 + 농장 탭 바 (디자인 "스코프 페이지" 구조).
 * 탭: 상태 / 생육기·센서 / 로봇 / 작업·공급 / 알림
 */

import { useParams, usePathname } from "next/navigation";
import { useFarmData, useScope } from "@/lib/farmData";

const TABS = [
  { seg: "status", label: "상태" },
  { seg: "env", label: "생육기·센서" },
  { seg: "robot", label: "로봇" },
  { seg: "supply", label: "작업·공급" },
  { seg: "alerts", label: "알림" },
];

export default function FarmLayout({ children }: { children: React.ReactNode }) {
  const { farmId } = useParams<{ farmId: string }>();
  const pathname = usePathname();
  useScope(farmId);
  const { farmName, conns, alerts } = useFarmData();

  const edge = Object.values(conns).find((c) => c.device_id.startsWith("edge"));
  const unacked = Object.values(alerts).filter((a) => !a.acked_at).length;
  const current = TABS.find((t) => pathname.endsWith(`/${t.seg}`))?.seg ?? "status";

  return (
    <div className="mx-auto max-w-7xl px-6 py-5">
      {/* 스코프 스위처 — 농장이 늘면 줄바꿈이 아니라 가로 스크롤 */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link
          href="/"
          className="shrink-0 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-13 font-bold text-gray-600"
        >
          전체 현황
        </Link>
        {farms.map((f) => (
          <Link
            key={f.farm_id}
            href={`/farms/${f.farm_id}/${current}`}
            className={`shrink-0 whitespace-nowrap rounded-xl border px-3.5 py-1.5 text-13 ${
              f.farm_id === farmId
                ? "border-primary bg-primary font-extrabold text-white"
                : "border-gray-200 bg-white font-bold text-gray-600"
            }`}
          >
            {f.name}
          </Link>
        ))}
      </div>

      {/* 농장 헤더 */}
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-20 font-extrabold">{farmName || farmId}</h1>
        <StatusDot
          sev={edge?.state === "online" ? "ok" : edge?.state === "degraded" ? "caution" : "warning"}
          label={edge?.state === "online" ? "정상 가동" : edge?.state === "degraded" ? "응답 지연" : "통신 단절"}
        />
      </div>

      {/* 탭 바 — overflow 는 래퍼에 둔다. nav 에 걸면 overflow-y 도 auto 가 되어
          활성 탭의 -mb-px(밑줄 겹침)가 1px 세로 스크롤을 만든다 */}
      <div className="mb-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <nav className="flex w-max min-w-full gap-1 border-b border-gray-200">
          {TABS.map((t) => {
            const active = t.seg === current;
            return (
              <Link
                key={t.seg}
                href={`/farms/${farmId}/${t.seg}`}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-[3px] px-3.5 py-2 text-13.5 ${
                  active
                    ? "border-primary font-extrabold text-primary-dark"
                    : "border-transparent font-semibold text-gray-500"
                }`}
              >
                {t.label}
                {t.seg === "alerts" && unacked > 0 && (
                  <span className="ml-1.5 rounded-full bg-status-warning px-1.5 text-11 font-extrabold text-white">
                    {unacked}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
      
    </div>
  );
}
