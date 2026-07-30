"use client";

/**
 * 통계·분석 (디자인 "전역: 통계·분석") — FR-14.
 * 기간 세그먼트 · 농장 칩 · 온·습도 추이 차트 · 요약 KPI
 * 주·월 집계와 양액·급수 사용량은 개발 예정.
 */

import { useEffect, useState } from "react";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import { Card, LineChart, SectionTitle, SENSOR_META } from "@/components/ui";
import { useFarmData, useScope } from "@/lib/farmData";
import { HistoryPoint, fetchHistory } from "@/lib/farmDetail";

const PERIODS = [
  { key: "6h", label: "6시간", hours: 6, bucket: 15 },
  { key: "24h", label: "24시간", hours: 24, bucket: 30 },
  { key: "7d", label: "7일", hours: 168, bucket: 180 },
] as const;

interface Summary { sensor_type: string; avg: number; min: number; max: number; count: number }

export default function StatsPage() {
  useScope("all");
  const { farms } = useFarmData();
  const [farmId, setFarmId] = useState<string>("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[1]);
  const [temp, setTemp] = useState<HistoryPoint[]>([]);
  const [hum, setHum] = useState<HistoryPoint[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(false);

  // 농장 목록이 오면 첫 농장 선택
  useEffect(() => {
    if (!farmId && farms.length) setFarmId(farms[0].farm_id);
  }, [farms, farmId]);

  useEffect(() => {
    if (!farmId) return;
    setLoading(true);
    void Promise.all([
      fetchHistory(farmId, "temperature", period.hours, period.bucket),
      fetchHistory(farmId, "humidity", period.hours, period.bucket),
      fetch(`/api/farms/${farmId}/environment/summary?hours=${period.hours}`).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([t, h, s]) => {
      setTemp(t); setHum(h); setSummary(s); setLoading(false);
    });
  }, [farmId, period]);

  const stat = (type: string) => summary.find((s) => s.sensor_type === type);
  const power = stat("power");

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold">통계·분석</h1>
        <span className="text-[13px] font-semibold text-muted">생육환경 집계 및 조회</span>
      </div>

      {/* 기간 · 농장 선택 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] ${
                period.key === p.key ? "bg-primary font-extrabold text-white" : "font-bold text-gray-500"
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="flex items-center gap-1 pl-1.5">
            <span className="text-[12px] font-bold text-gray-300">주·월</span>
            <PlannedChip basis="FR-14 집계" />
          </span>
        </span>

        <span className="flex flex-wrap gap-1.5">
          {farms.map((f) => (
            <button
              key={f.farm_id}
              onClick={() => setFarmId(f.farm_id)}
              className={`rounded-xl border px-3 py-1.5 text-[12.5px] ${
                farmId === f.farm_id
                  ? "border-primary bg-primary-bg font-extrabold text-primary-dark"
                  : "border-gray-200 bg-white font-bold text-gray-500"
              }`}
            >
              {f.name}
            </button>
          ))}
        </span>
      </div>

      {/* 요약 KPI */}
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { type: "temperature", label: "평균 온도" },
          { type: "humidity", label: "평균 습도" },
          { type: "ec", label: "평균 EC" },
        ].map(({ type, label }) => {
          const s = stat(type);
          const meta = SENSOR_META[type];
          return (
            <Card key={type}>
              <div className="text-[13px] font-bold text-gray-500">{label}</div>
              <div className="mt-1 text-[24px] font-extrabold">
                {s ? s.avg.toFixed(1) : "—"}
                <span className="ml-0.5 text-[12px] font-bold text-muted">{meta.unit}</span>
              </div>
              <div className="mt-1 text-[11.5px] font-semibold text-muted">
                {s ? `최저 ${s.min.toFixed(1)} · 최고 ${s.max.toFixed(1)}` : "데이터 없음"}
              </div>
            </Card>
          );
        })}
        <Card>
          <div className="text-[13px] font-bold text-gray-500">평균 소모전력</div>
          <div className="mt-1 text-[24px] font-extrabold">
            {power ? power.avg.toFixed(2) : "—"}
            <span className="ml-0.5 text-[12px] font-bold text-muted">kW</span>
          </div>
          <div className="mt-1 text-[11.5px] font-semibold text-muted">
            {power ? `표본 ${power.count.toLocaleString()}건` : "데이터 없음"}
          </div>
        </Card>
      </section>

      {/* 추이 차트 */}
      <section className="mb-5">
        <Card>
          <SectionTitle
            title="온·습도 추이"
            sub={`${period.label} · ${period.bucket}분 평균`}
            right={loading ? <span className="text-[12px] font-semibold text-muted">불러오는 중…</span> : undefined}
          />
          <LineChart
            height={240}
            series={[
              {
                name: "온도", color: SENSOR_META.temperature.color,
                points: temp.map((h) => ({ ts: h.ts, value: h.avg })),
              },
              {
                name: "습도", color: SENSOR_META.humidity.color,
                points: hum.map((h) => ({ ts: h.ts, value: h.avg })),
              },
            ]}
            unitLabels={["℃", "%"]}
          />
          <p className="mt-2 text-[11.5px] font-semibold text-muted">
            두 계열의 값 범위가 달라 축을 공유합니다. 축 분리는 추후 개선 항목입니다.
          </p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlannedBox feature="양액·급수·방재 사용량" basis="증분 8 · FR-14">
          작업 임무가 구현되면 기간별 공급량을 집계해 막대 그래프로 표시합니다.
        </PlannedBox>
        <PlannedBox feature="생육 상태 통계 · 조건별 조회·내보내기" basis="FR-09·15">
          성장률·병충해 추이(FR-09 AI 분석 연동)와 조건 조합 조회·CSV 내보내기(FR-15)가 추가됩니다.
        </PlannedBox>
      </section>
    </main>
  );
}
