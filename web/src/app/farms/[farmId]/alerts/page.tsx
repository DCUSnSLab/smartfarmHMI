"use client";

/**
 * 농장 상세 · 알림 (디자인 "농장 상세: 알림") — 심각도 필터·읽음·딥링크.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertList } from "@/components/AlertPanel";
import { GO_LINK, SectionTitle } from "@/components/ui";
import { useFarmData } from "@/lib/farmData";

export default function FarmAlertsTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const { alerts, farmName } = useFarmData();

  return (
    <>
      <SectionTitle
        title="알림" sub={farmName || farmId}
        right={
          <Link href={`/settings?farm=${farmId}&section=rules`} scroll={false} className={GO_LINK}>
            알림 규칙 설정
          </Link>
        }
      />
      <AlertList alerts={Object.values(alerts)} farmId={farmId} />
    </>
  );
}
