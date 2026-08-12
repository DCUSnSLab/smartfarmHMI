"use client";

/**
 * 농장 상세 · 작업·공급 (디자인 "농장 상세: 작업·공급").
 * 탱크 수위 · 워크스테이션·파레트 흐름 · 랙 슬롯 · 작업 스케줄/양·농도 설정(Planned)
 */

import { useParams } from "next/navigation";
import { PlannedBox } from "@/components/Planned";
import { Card, Gauge, SectionTitle, StatusDot, STATION_STATE, TANK_LABEL, TANK_LOW_PCT } from "@/components/ui";
import { useFarmSnapshot } from "@/lib/farmDetail";

export default function SupplyTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const snap = useFarmSnapshot(farmId);

  const tanks = snap?.tanks ?? [];
  const stations = snap?.stations ?? [];
  const rack = snap?.rack ?? {};

  return (
    <>
      {/* 탱크 수위 */}
      <section className="mb-6">
        <SectionTitle title="탱크 수위" sub="농장 공용 · 잔량은 용량·소비율 기준 환산" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tanks.map((t) => {
            const low = (t.level_pct ?? 100) < TANK_LOW_PCT;
            return (
              <Card key={t.device_id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-13.5 font-bold text-gray-600">
                    {TANK_LABEL[t.tank_type] ?? t.tank_type} 탱크
                  </span>
                  <span className={`text-24 font-extrabold ${low ? "text-status-warningDark" : ""}`}>
                    {t.level_pct != null ? Math.round(t.level_pct) : "—"}
                    <span className="text-12 font-bold text-muted">%</span>
                  </span>
                </div>
                <Gauge value={t.level_pct} okMin={TANK_LOW_PCT} okMax={100} unit="%" />
                <div className="mt-2 text-12.5 font-semibold text-muted">
                  {t.remain_l != null ? `약 ${t.remain_l}L` : "—"}
                  {t.days_left != null && ` · ${t.days_left}일분`}
                  {t.uses_left != null && ` · ${t.uses_left}회분`}
                  <span className="ml-1 text-11.5">(용량 {t.capacity_l}L)</span>
                </div>
                {low && (
                  <div className="mt-2 rounded-lg bg-status-warning/10 px-2.5 py-1.5 text-12 font-bold text-status-warningDark">
                    잔량 부족 — 보충이 필요해요
                  </div>
                )}
              </Card>
            );
          })}
          {tanks.length === 0 && (
            <Card className="sm:col-span-3">
              <div className="text-13 font-semibold text-muted">
                등록된 탱크가 없어요. 설정에서 탱크를 추가하면 수위·잔량이 표시됩니다.
              </div>
            </Card>
          )}
        </div>
      </section>

      {/* 워크스테이션 + 랙 */}
      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle title="워크스테이션" sub="로봇이 트레이를 운반해 작업하는 위치" />
          <div className="space-y-2">
            {stations.map((s) => {
              const st = STATION_STATE[s.state] ?? STATION_STATE.idle;
              return (
                <div key={s.station_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface px-3.5 py-2.5">
                  <span className="text-13.5 font-extrabold">{s.station_id}</span>
                  <span className="whitespace-nowrap text-12.5 font-semibold text-muted">
                    {TANK_LABEL[s.station_type] ?? s.station_type} 스테이션
                  </span>
                  <span className="ml-auto shrink-0"><StatusDot sev={st.sev} label={st.label} /></span>
                </div>
              );
            })}
            {stations.length === 0 && (
              <div className="text-13 font-semibold text-muted">등록된 워크스테이션이 없어요</div>
            )}
          </div>
        </Card>

        <Card>
          <SectionTitle title="랙 슬롯" sub="파레트 보관 현황" />
          <div className="mb-3 text-26 font-extrabold">
            {rack.slots ?? 0}
            <span className="ml-1 text-13 font-bold text-muted">칸</span>
          </div>
          <div className="space-y-1.5 text-12.5 font-semibold text-gray-600">
            <div className="flex justify-between">
              <span>파레트</span><b>{rack.pallets ?? 0}개</b>
            </div>
            <div className="flex justify-between">
              <span>보관 중</span><b>{rack.stored ?? 0}</b>
            </div>
            <div className="flex justify-between">
              <span>이동 중</span><b>{rack.moving ?? 0}</b>
            </div>
            <div className="flex justify-between">
              <span>작업 중</span><b>{rack.at_station ?? 0}</b>
            </div>
          </div>
        </Card>
      </section>

      {/* 스케줄·설정 (증분 8) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlannedBox feature="작업 스케줄 (수동·자동)" basis="증분 8 · FR-19·20">
          생육기별로 양액·급수·방재 작업의 1일 횟수와 시각을 설정합니다.
          스케줄 시각에 도달하면 미들웨어가 파레트 임무로 변환해 엣지로 발행합니다.
          자동 스케줄링(FR-20)은 엣지의 생육상태 판단을 받아 표시합니다.
        </PlannedBox>
        <PlannedBox feature="양·농도 설정 (양액·급수·방재)" basis="증분 8 · FR-21·23·25">
          회당 양액량·농도(EC), 급수량, 방재액량을 각각 동등한 수준으로 설정합니다.
          설정값은 임무 실행 시 파라미터로 전달됩니다.
        </PlannedBox>
      </section>
    </>
  );
}
