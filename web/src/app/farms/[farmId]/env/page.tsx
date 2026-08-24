"use client";

/**
 * 농장 상세 · 생육기·센서 (디자인 "농장 상세: 생육기·센서").
 * 실시간 환경값 · 환경 제어 · 생육 상태(Planned) · 센서 목록 → 센서 상세 모달
 *
 * 생육기 단위 선택 축은 OPN-16 확정 후 추가 (현재는 농장당 재배공간 1개 전제).
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { ControlPanel } from "@/components/ControlPanel";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import { SensorModal } from "@/components/SensorModal";
import { Card, SectionTitle, StatusDot } from "@/components/ui";
import { CONN_STYLE, SENSOR_META } from "@/lib/severity";
import { canControl, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { useFarmSnapshot } from "@/lib/farmDetail";
import { SensorValue, controlBlocked, timeAgo } from "@/lib/monitor";

export default function EnvTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const user = useUser();
  const { sensors, conns, commands, stops } = useFarmData();
  // 적정 범위는 스냅샷이 싣고 온다 — 알림 규칙을 따로 부르면 요청이 하나 늘고,
  // 무엇보다 근거가 둘이 된다 (스냅샷은 enabled 인 규칙만 싣는다).
  const ranges = useFarmSnapshot(farmId)?.ranges ?? {};
  const [selected, setSelected] = useState<SensorValue | null>(null);

  const list = Object.values(sensors);
  const envList = list.filter((s) => s.sensor_type !== "water_level");
  const edge = Object.values(conns).find((c) => c.device_id.startsWith("edge"));
  const farmOnline = edge?.state === "online";
  const stopped = controlBlocked(stops, farmId);

  const outOfRange = (s: SensorValue) => {
    const r = ranges[s.sensor_type];
    if (!r || s.value == null) return false;
    return (r.min != null && s.value < r.min) || (r.max != null && s.value > r.max);
  };

  return (
    <>
      {/* 실시간 환경값 */}
      <section className="mb-6">
        <SectionTitle
          title="실시간 환경값"
          sub={`${envList.length}개 항목 · 센서 ${list.length}대 측정값`}
          right={<PlannedChip basis="OPN-16 생육기 단위 선택" />}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {envList.map((s) => {
            const meta = SENSOR_META[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
            const bad = outOfRange(s);
            return (
              <Card key={s.sensor_id} className={!farmOnline ? "opacity-60" : ""}>
                <div className="text-13 font-bold text-gray-500">{meta.name}</div>
                <div className={`mt-1 text-22 font-extrabold ${bad ? "text-status-cautionDark" : ""}`}>
                  {s.value != null ? s.value.toFixed(1) : "—"}
                  <span className="ml-0.5 text-12 font-bold text-muted">{meta.unit}</span>
                </div>
                <div className="mt-1 text-11.5 font-semibold text-muted">
                  {bad ? "범위 밖" : "적정"} · {timeAgo(s.ts)}
                </div>
              </Card>
            );
          })}
          {envList.length === 0 && (
            <Card className="col-span-full">
              <div className="text-13 font-semibold text-muted">
                센서 데이터가 없어요. 장비가 등록되고 데이터가 수신되면 표시됩니다.
              </div>
            </Card>
          )}
        </div>
      </section>

      {/* 환경 제어 (FR-10) */}
      <ControlPanel
        farmId={farmId} deviceId="growbed-01" commands={commands}
        disabled={!farmOnline || !canControl(user) || stopped}
        disabledReason={
          stopped ? "정지 발동 중 — 원격 제어가 차단되었습니다 (FR-35)"
          : !farmOnline ? "통신 단절 — 제어를 사용할 수 없습니다"
          : !canControl(user) ? "조회 전용 계정 — 제어 권한이 없습니다"
          : undefined
        }
      />

      {/* 생육 상태 (FR-09) */}
      <section className="mb-6">
        <SectionTitle title="생육 상태" sub="영상 기반 AI 분석" />
        <PlannedBox feature="성장률 · 병충해 · 예상 수확시기" basis="FR-09 · 외부 AI 연동">
          로봇 카메라 영상을 외부 AI(VLM)로 분석해 착과·병해를 인식하고 성장률·수확 시기를 표시합니다.
          영상 수집은 엣지, 분석은 외부 연동 훅으로 처리됩니다.
        </PlannedBox>
      </section>

      {/* 센서 목록 */}
      <section>
        <SectionTitle
          title="센서 목록" sub={`${list.length}개 · 행을 누르면 상세·추이를 볼 수 있어요`}
        />
        {/* 5열 표는 좁은 폭·큰글씨에서 열이 짓눌려 글자가 세로로 읽힌다. sm 미만에서는
            행을 블록으로 쌓아, 폭·글자 크기와 무관하게 각 값이 자기 자리를 갖게 한다.
            열 머리글은 표 형태일 때만 의미가 있어 카드형에서는 감춘다. */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="hidden border-b border-gray-100 px-4 py-2.5 text-11.5 font-extrabold text-gray-500 sm:grid sm:grid-cols-[2fr_1.2fr_1fr_1fr_1fr] sm:gap-3">
            <span>센서</span>
            <span>위치</span>
            <span className="text-right">현재값</span>
            <span>상태</span>
            <span className="text-right">수신</span>
          </div>

          {list.map((s) => {
            const meta = SENSOR_META[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
            const c = conns[s.sensor_id] ?? conns["growbed-01"];
            const conn = {
              sev: c ? (CONN_STYLE[c.state]?.sev ?? "info") : "info",
              label: c ? CONN_STYLE[c.state]?.label : "—",
            };
            return (
              <button
                key={s.sensor_id}
                onClick={() => setSelected(s)}
                className="block w-full cursor-pointer border-b border-gray-50 px-4 py-3 text-left text-13 last:border-0 hover:bg-surface sm:grid sm:grid-cols-[2fr_1.2fr_1fr_1fr_1fr] sm:items-center sm:gap-3 sm:py-2.5"
              >
                {/* 카드형(좁은 폭): 이름과 값을 한 줄에 마주 놓고, 나머지는 아래 줄에 모은다 */}
                <span className="flex items-baseline justify-between gap-2 sm:block">
                  <span className="min-w-0 font-bold">
                    {meta.name}
                    <span className="ml-1.5 text-11.5 font-semibold text-muted">{s.sensor_id}</span>
                  </span>
                  <span className="shrink-0 font-extrabold sm:hidden">
                    {s.value != null ? `${s.value.toFixed(1)}${meta.unit}` : "—"}
                  </span>
                </span>

                <span className="mt-1 flex items-center gap-2 text-11.5 font-semibold text-muted sm:mt-0 sm:contents">
                  <span className="min-w-0 truncate sm:font-semibold sm:text-13 sm:text-gray-600">
                    {s.location ?? "—"}
                  </span>
                  <span className="hidden text-right font-extrabold text-body sm:block">
                    {s.value != null ? `${s.value.toFixed(1)}${meta.unit}` : "—"}
                  </span>
                  <span aria-hidden="true" className="sm:hidden">·</span>
                  <StatusDot sev={conn.sev} label={conn.label} />
                  <span aria-hidden="true" className="sm:hidden">·</span>
                  <span className="ml-auto shrink-0 sm:ml-0 sm:text-right sm:text-13">{timeAgo(s.ts)}</span>
                </span>
              </button>
            );
          })}

          {list.length === 0 && (
            <div className="px-4 py-8 text-center text-13 font-semibold text-muted">
              등록된 센서가 없어요
            </div>
          )}
        </div>
      </section>

      {selected && (
        <SensorModal
          farmId={farmId} sensor={selected}
          connState={(conns[selected.sensor_id] ?? conns["growbed-01"])?.state}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
