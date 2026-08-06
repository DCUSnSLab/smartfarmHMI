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

export function useWeather() {
  const [rows, setRows] = useState<WeatherRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      void apiFetch("/api/weather")
        .then(async (response) => response.ok ? response.json() : [])
        .then((data: WeatherRow[]) => { if (active) setRows(data); })
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => { active = false; clearInterval(timer); };
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
