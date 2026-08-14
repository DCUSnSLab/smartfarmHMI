"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface WeatherRow {
  farm_id: string;
  name: string;
  region_code: string | null;
  latitude: number | null;
  longitude: number | null;
  ts: string | null;
  received_at: string | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  wind_ms: number | null;
  condition: string | null;
  solar_level: string | null;
  provider: string | null;
}

/**
 * 다음 조회 시각까지 남은 ms — 서버가 매시 40분에만 수집하므로 그 직후 한 번만 받는다.
 * 고정 간격이면 같은 값을 시간당 12번 받고, 정작 갱신 직후를 놓친다.
 */
const SLOT_MINUTE = 41;   // 수집(40분)이 끝날 여유 1분

function msUntilNextSlot(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(SLOT_MINUTE, 0, 0);
  if (next <= now) next.setHours(next.getHours() + 1);
  return next.getTime() - now.getTime();
}

/**
 * 기상 조회 — 소유자는 FarmDataProvider 하나뿐이다. 화면마다 부르면 이동할 때마다
 * 새로 마운트돼 loading 이 되살아나, 값이 있는데도 「로딩중」이 스친다.
 */
export function useWeather() {
  const [rows, setRows] = useState<WeatherRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 수동 새로고침(FarmWeather)도 이 함수를 쓴다
  const reload = useCallback(async (): Promise<WeatherRow[]> => {
    const response = await apiFetch("/api/weather");
    const nextRows = response.ok ? await response.json() as WeatherRow[] : [];
    if (response.ok) setRows(nextRows);
    setLoading(false);
    return nextRows;
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await reload();
      if (!active) return;
      // 매번 다시 계산한다 — 절전에서 깨어나 늦게 실행돼도 스스로 정렬된다
      timer = setTimeout(() => void tick(), msUntilNextSlot());
    };

    void tick();
    return () => { active = false; clearTimeout(timer); };
  }, [reload]);

  return { rows, loading, reload };
}

export async function refreshWeather(farmId: string): Promise<boolean> {
  return (await apiFetch(`/api/farms/${farmId}/weather/refresh`, { method: "POST" })).ok;
}

export type WeatherConditionCodes = {
  sky: 1 | 3 | 4;
  pty: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

export function parseWeatherCondition(condition: string | null): WeatherConditionCodes | null {
  const match = condition?.match(/^SKY([134])-PTY([0-7])$/);
  if (match) {
    return {
      sky: Number(match[1]) as WeatherConditionCodes["sky"],
      pty: Number(match[2]) as WeatherConditionCodes["pty"],
    };
  }
  // 새 형식으로 갱신되기 전의 SKY 단독 저장값을 임시로 지원한다.
  if (condition === "1" || condition === "3" || condition === "4") {
    return { sky: Number(condition) as WeatherConditionCodes["sky"], pty: 0 };
  }
  return null;
}

export function weatherConditionLabel(condition: string | null): string {
  const codes = parseWeatherCondition(condition);
  if (!codes) return condition ?? "정보 없음";
  const precipitationLabels: Record<number, string> = {
    1: "비", 2: "비/눈", 3: "눈", 4: "소나기",
    5: "빗방울", 6: "빗방울/눈날림", 7: "눈날림",
  };
  if (codes.pty !== 0) return precipitationLabels[codes.pty];
  if (codes.sky === 1) return "맑음";
  if (codes.sky === 3) return "구름많음";
  if (codes.sky === 4) return "흐림";
  return condition ?? "정보 없음";
}

export function isValidWeatherLocation(
  latitude: number | null,
  longitude: number | null,
): boolean {
  return latitude != null && longitude != null
    && latitude >= 32 && latitude <= 40
    && longitude >= 123 && longitude <= 133;
}

export function uvIndexLabel(value: string | null): string {
  const index = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(index) || index < 0) return "정보 없음";
  if (index <= 2) return "낮음";
  if (index <= 5) return "보통";
  if (index <= 7) return "높음";
  if (index <= 10) return "매우높음";
  return "위험";
}

export function isKoreaDaytime(at: Date | string = new Date()): boolean {
  const date = at instanceof Date ? at : new Date(at);
  const hour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", hour: "2-digit", hourCycle: "h23",
  }).format(date));
  return hour >= 6 && hour < 18;
}

export function weatherIcon(
  condition: string | null,
  at: Date | string = new Date(),
): string {
  const codes = parseWeatherCondition(condition);
  if (!codes) return "🌤️";
  if ([1, 2, 4, 5, 6].includes(codes.pty)) return "🌧️";
  if ([3, 7].includes(codes.pty)) return "🌨️";
  const daytime = isKoreaDaytime(at);
  if (codes.sky === 1) return daytime ? "☀️" : "🌙";
  if (codes.sky === 3) return daytime ? "🌤️" : "☁️";
  return "☁️";
}
