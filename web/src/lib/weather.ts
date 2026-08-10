"use client";

import { useEffect, useState } from "react";
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
 * 다음 조회 시각까지 남은 ms — 서버가 **매시 40분에만** 수집하므로(weather.py
 * weather_collection_loop) 그 직후 한 번만 받는다. 고정 간격으로 돌리면 같은 값을
 * 시간당 12번 받고, 정작 갱신 직후를 놓쳐 최대 55분 묵은 값을 보게 된다.
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
 * 기상 조회 — **소유자는 FarmDataProvider 하나뿐이다.**
 *
 * 화면마다 부르면 이동할 때마다 새로 마운트돼 loading 이 true 로 되돌아가고,
 * 이미 받아둔 값이 있는데도 「로딩중」이 한 번 스쳤다가 값으로 바뀐다. 소유자를
 * 하나로 두면 마운트가 앱 시작 때 한 번이라, 이후 갱신은 값만 조용히 교체된다.
 */
export function useWeather() {
  const [rows, setRows] = useState<WeatherRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = () => {
      void apiFetch("/api/weather")
        .then(async (response) => response.ok ? response.json() : [])
        .then((data: WeatherRow[]) => { if (active) setRows(data); })
        .finally(() => {
          if (!active) return;
          setLoading(false);
          // 매번 다음 시각을 다시 계산한다 — 절전에서 깨어나 늦게 실행돼도 스스로 정렬된다
          timer = setTimeout(load, msUntilNextSlot());
        });
    };

    load();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  return { rows, loading };
}

export function weatherConditionLabel(condition: string | null): string {
  if (condition === "1") return "맑음";
  if (condition === "3") return "구름많음";
  if (condition === "4") return "흐림";
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

export function weatherIcon(condition: string | null, precipitationMm: number | null): string {
  if ((precipitationMm ?? 0) > 0) return "🌧️";
  if (condition === "1" || condition?.includes("맑음")) return "☀️";
  if (condition === "3" || condition?.includes("구름")) return "🌤️";
  if (condition === "4" || condition?.includes("흐림")) return "☁️";
  if (condition?.includes("비/눈")) return "🌨️";
  if (condition?.includes("눈")) return "❄️";
  if (condition?.includes("소나기")) return "🌦️";
  if (condition?.includes("비")) return "🌧️";
  return "🌤️";
}
