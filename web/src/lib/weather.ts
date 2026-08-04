"use client";

import { useEffect, useState } from "react";

export interface WeatherRow {
  farm_id: string;
  name: string;
  region_code: string | null;
  ts: string | null;
  received_at: string | null;
  temperature_c: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  wind_ms: number | null;
  condition: string | null;
  provider: string | null;
}

export function useWeather() {
  const [rows, setRows] = useState<WeatherRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetch("/api/weather")
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

export function weatherIcon(condition: string | null, precipitationMm: number | null): string {
  if (condition?.includes("비/눈") || condition?.includes("빗방울/눈")) return "🌨️";
  if (condition?.includes("눈")) return "❄️";
  if (condition?.includes("빗방울")) return "🌦️";
  if (condition?.includes("비") || (precipitationMm ?? 0) > 0) return "🌧️";
  return "🌤️";
}

export function weatherCardBackground(condition: string | null): string {
  if (condition?.includes("눈") && !condition.includes("비")) {
    return "from-sky-200 to-blue-400";
  }
  if (condition?.includes("비") || condition?.includes("빗방울")) {
    return "from-sky-400 to-blue-600";
  }
  return "from-sky-300 to-blue-500";
}
