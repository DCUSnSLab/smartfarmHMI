"use client";

/**
 * 팜 데이터 컨텍스트 — 주기 조회를 앱 전역에 하나씩만 두고 공유한다.
 *
 * 화면이 여러 페이지로 나뉘면서 페이지마다 WebSocket 을 열면 브리지 부하와
 * 중복 구독이 생긴다. 셸에서 한 번만 연결하고 스코프만 전환한다.
 * (검증된 useMonitor 로직은 그대로 재사용 — 여기서는 스코프 관리만 추가)
 *
 * 같은 이유로 전 농장 스냅샷 폴링도 여기서 소유한다. 소비하는 컴포넌트가 각자 훅을
 * 부르면 15 초마다 같은 요청이 겹쳐 나간다. 알림은 폴링하지 않는다 — WS 로만 갱신되고
 * 이 컨텍스트가 전체/스코프 두 가지 시야로 나눠 준다.
 */

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FarmSnapshot, showsFleetNav, useFleetSnapshots } from "@/lib/fleet";
import { AlertItem, useMonitor } from "@/lib/monitor";
import { WeatherRow, useWeather } from "@/lib/weather";

type MonitorData = ReturnType<typeof useMonitor>;

interface FarmDataCtx extends MonitorData {
  scope: string;              // "all" | farmId
  setScope: (s: string) => void;
  /** 스코프와 무관한 전체 알림 — 헤더 벨과 스코프 스위처 상태색이 쓴다.
   *  스코프에 따라 좁혀지는 alerts 와 달리 농장을 클릭해도 범위가 유지된다.
   *  같은 저장소를 거른 것이라 둘의 실시간성이 어긋나지 않는다. */
  globalAlerts: Record<number, AlertItem>;
  /** 전 농장 스냅샷 — 대시보드 카드와 스코프 스위처 점. */
  snaps: Record<string, FarmSnapshot>;
  /** 농장별 기상 — 서버가 매시 40분에만 수집하므로 여기서 한 번만 조회한다. */
  weather: WeatherRow[];
  weatherLoading: boolean;
  /** 수동 새로고침 뒤 다시 읽기 (상태 화면의 날씨 카드) */
  reloadWeather: () => Promise<void>;
}

const Ctx = createContext<FarmDataCtx | null>(null);

export function FarmDataProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState("all");
  const data = useMonitor(scope);
  // useMonitor 의 alerts 는 전 농장분 한 벌이다 (WS 가 스코프와 무관하게 넣어 준다).
  // 화면 대부분은 보고 있는 범위만 필요하므로 여기서 걸러 두 이름으로 내보낸다.
  const scopedAlerts = useMemo(
    () => (scope === "all"
      ? data.alerts
      : Object.fromEntries(
          Object.entries(data.alerts).filter(([, a]) => a.farm_id === scope),
        )),
    [data.alerts, scope],
  );

  // 셸은 모든 화면에 붙으므로, 스냅샷을 쓰지 않는 화면(설정·일지 등)에서는 농장 목록을
  // 비워 폴링을 멈춘다 — 아무도 보지 않는 요청이 농장 수만큼 나가는 것을 막는다.
  const pathname = usePathname();
  const snaps = useFleetSnapshots(
    showsFleetNav(pathname) ? data.farms.map((f) => f.farm_id) : [],
    data.liveTick,
  );

  // 실시간 맵의 출발점을 전 농장 스냅샷에서 꺼낸다. 예전에는 useMonitor 가 농장을
  // 옮길 때마다 `/farms/{id}/snapshot` 을 따로 받았는데, 위 폴링이 **같은 페이로드**를
  // 이미 담고 있어 요청 하나가 그대로 중복이었다. 스코프당 한 번만 뿌린다 (seedLive).
  const { seedLive } = data;
  useEffect(() => {
    if (scope === "all") return;
    const snap = snaps[scope];
    if (snap) seedLive(scope, snap);
  }, [scope, snaps, seedLive]);

  const { rows: weather, loading: weatherLoading, reload: reloadWeather } = useWeather();

  return (
    <Ctx.Provider
      value={{
        ...data, alerts: scopedAlerts, globalAlerts: data.alerts,
        scope, setScope, snaps,
        weather, weatherLoading, reloadWeather,
      }}
    >
      {children}
    </Ctx.Provider>
  );
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
