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

      {children}
      
    </div>
  );
}
