"use client";

/**
 * 통계·분석 (디자인 "전역: 통계·분석") — FR-14.
 * 기간 세그먼트 · 농장 칩 · 온·습도 추이 차트 · 요약 KPI
 * 주·월 집계와 양액·급수 사용량은 개발 예정.
 */

import { useEffect, useState } from "react";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import { Card, LineChart, NavItemData, ScopeBar, SectionTitle } from "@/components/ui";
import { SENSOR_META } from "@/lib/severity";
import { apiFetch } from "@/lib/api";
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
      apiFetch(`/api/farms/${farmId}/environment/summary?hours=${period.hours}`).then((r) =>
        r.ok ? r.json() : [],
      ),
    ]).then(([t, h, s]) => {
      setTemp(t); setHum(h); setSummary(s); setLoading(false);
    });
  }, [farmId, period]);

  const stat = (type: string) => summary.find((s) => s.sensor_type === type);
  const power = stat("power");

  // 농장 선택은 대시보드의 스코프 스위처와 같은 자리(헤더 바로 아래)·같은 모양으로 둔다.
  // 화면마다 농장을 고르는 위치가 다르면 매번 찾아야 한다. 여기서는 이동이 아니라
  // 필터라 href 대신 onSelect 를 쓴다.
  const farmItems: NavItemData[] = farms.map((f) => ({
    key: f.farm_id,
    label: f.name,
    active: farmId === f.farm_id,
    onSelect: () => setFarmId(f.farm_id),
  }));

  return (
    <>
      <ScopeBar items={farmItems} ariaLabel="농장 선택" />

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-5 flex flex-wrap items-baseline gap-3">
          <h1 className="text-22 font-extrabold">통계·분석</h1>
          <span className="text-13 font-semibold text-muted">생육환경 집계 및 조회</span>
        </div>

        {/* 기간 선택 — 라벨은 쪼개지지 않게 고정하고, 개발 예정 표기는 상자 밖으로 뺀다
            (상자 안에 두면 큰글씨에서 자리를 뺏어 「6시 간」처럼 줄바꿈된다) */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-12.5 ${
                  period.key === p.key ? "bg-primary font-extrabold text-white" : "font-bold text-gray-500"
                }`}
              >
                {p.label}
              </button>
            ))}
          </span>

          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap text-12 font-bold text-gray-300">주·월</span>
            <PlannedChip basis="FR-14 집계" />
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
                <div className="text-13 font-bold text-gray-500">{label}</div>
                <div className="mt-1 text-24 font-extrabold">
                  {s ? s.avg.toFixed(1) : "—"}
                  <span className="ml-0.5 text-12 font-bold text-muted">{meta.unit}</span>
                </div>
                <div className="mt-1 text-11.5 font-semibold text-muted">
                  {s ? `최저 ${s.min.toFixed(1)} · 최고 ${s.max.toFixed(1)}` : "데이터 없음"}
                </div>
              </Card>
            );
          })}
          <Card>
            <div className="text-13 font-bold text-gray-500">평균 소모전력</div>
            <div className="mt-1 text-24 font-extrabold">
              {power ? power.avg.toFixed(2) : "—"}
              <span className="ml-0.5 text-12 font-bold text-muted">kW</span>
            </div>
            <div className="mt-1 text-11.5 font-semibold text-muted">
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
              right={loading ? <span className="text-12 font-semibold text-muted">불러오는 중…</span> : undefined}
            />
            <LineChart
              height={240}
              series={[
                {
                  name: "온도", unit: "℃", color: SENSOR_META.temperature.color,
                  points: temp.map((h) => ({ ts: h.ts, value: h.avg })),
                },
                {
                  name: "습도", unit: "%", color: SENSOR_META.humidity.color,
                  points: hum.map((h) => ({ ts: h.ts, value: h.avg })),
                },
              ]}
            />
            <p className="mt-2 text-11.5 font-semibold text-muted">
              온도는 좌축, 습도는 우축 — 값 범위가 다른 계열을 각각의 축으로 표시합니다.
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
    </>
  );
}
