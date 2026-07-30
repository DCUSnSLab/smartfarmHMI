"use client";

/**
 * 팜 데이터 컨텍스트 — useMonitor(WS·스냅샷·명령·알림·정지) 를 앱 전역에 공유한다.
 *
 * 화면이 여러 페이지로 나뉘면서 페이지마다 WebSocket 을 열면 브리지 부하와
 * 중복 구독이 생긴다. 셸에서 한 번만 연결하고 스코프만 전환한다.
 * (검증된 useMonitor 로직은 그대로 재사용 — 여기서는 스코프 관리만 추가)
 */

import { createContext, useContext, useEffect, useState } from "react";
import { useMonitor } from "@/lib/monitor";

type MonitorData = ReturnType<typeof useMonitor>;

interface FarmDataCtx extends MonitorData {
  scope: string;              // "all" | farmId
  setScope: (s: string) => void;
}

const Ctx = createContext<FarmDataCtx | null>(null);

export function FarmDataProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState("all");
  const data = useMonitor(scope);
  return <Ctx.Provider value={{ ...data, scope, setScope }}>{children}</Ctx.Provider>;
}

export function useFarmData(): FarmDataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFarmData 는 FarmDataProvider 안에서만 사용");
  return ctx;
}

/**
 * 페이지가 자신의 스코프를 선언한다 (경로 기반 라우팅과 WS 구독을 잇는 고리).
 * 농장 상세 페이지는 farmId, 전역 페이지는 "all".
 */
export function useScope(desired: string) {
  const { scope, setScope } = useFarmData();
  useEffect(() => {
    if (scope !== desired) setScope(desired);
  }, [desired, scope, setScope]);
  return scope;
}
