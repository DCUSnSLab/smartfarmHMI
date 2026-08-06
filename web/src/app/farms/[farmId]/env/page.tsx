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
import { Card, CONN_STYLE, SectionTitle, SENSOR_META, StatusDot } from "@/components/ui";
import { canControl, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { useRanges } from "@/lib/farmDetail";
import { SensorValue, controlBlocked, timeAgo } from "@/lib/monitor";

export default function EnvTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const user = useUser();
  const { sensors, conns, commands, stops } = useFarmData();
  const ranges = useRanges(farmId);
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
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 text-11.5 font-extrabold text-gray-500">
                <th className="px-4 py-2.5">센서</th>
                <th className="px-4 py-2.5">위치</th>
                <th className="px-4 py-2.5 text-right">현재값</th>
                <th className="px-4 py-2.5">상태</th>
                <th className="px-4 py-2.5 text-right">수신</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const meta = SENSOR_META[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
                const c = conns[s.sensor_id] ?? conns["growbed-01"];
                return (
                  <tr
                    key={s.sensor_id}
                    onClick={() => setSelected(s)}
                    className="cursor-pointer border-b border-gray-50 text-13 last:border-0 hover:bg-surface"
                  >
                    <td className="px-4 py-2.5 font-bold">
                      {meta.name}
                      <span className="ml-1.5 text-11.5 font-semibold text-muted">{s.sensor_id}</span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-gray-600">{s.location ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-extrabold">
                      {s.value != null ? `${s.value.toFixed(1)}${meta.unit}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusDot
                        sev={c ? (CONN_STYLE[c.state]?.sev ?? "info") : "info"}
                        label={c ? CONN_STYLE[c.state]?.label : "—"}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-muted">{timeAgo(s.ts)}</td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-13 font-semibold text-muted">
                    등록된 센서가 없어요
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
