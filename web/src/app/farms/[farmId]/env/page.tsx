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
import { CONN_STYLE, rangeSide, SENSOR_META } from "@/lib/severity";
import { canControl, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { useFarmSnapshot } from "@/lib/farmDetail";
import { SensorValue, controlBlocked, deviceLiveness, edgeConn, timeAgo } from "@/lib/monitor";

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
  const edge = edgeConn(conns);
  const farmOnline = edge?.state === "online";
  const stopped = controlBlocked(stops, farmId);

  // 판정은 어휘 모듈이 갖는다 — 상태 화면의 센서 등급과 같은 규칙을 써야 한다
  const outOfRange = (s: SensorValue) => rangeSide(s.value, ranges[s.sensor_type]) != null;

  // 제어 대상 생육기 — 센서가 자기 부모를 말해 준다 (장비 등록의 parent_device_id).
  // 예전에는 "growbed-01" 을 박아 두어, 생육기 id 가 다른 농장에서는 제어 요청이
  // 없는 장치로 나갔다. 모르면 보내지 않는다 — 어림짐작으로 명령을 던질 자리가 아니다.
  const growbedId = list.find((s) => s.parent_device_id)?.parent_device_id ?? null;

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
        farmId={farmId} deviceId={growbedId ?? ""} commands={commands}
        disabled={!growbedId || !farmOnline || !canControl(user) || stopped}
        disabledReason={
          stopped ? "정지 발동 중 — 원격 제어가 차단되었습니다 (FR-35)"
          : !farmOnline ? "통신 단절 — 제어를 사용할 수 없습니다"
          : !canControl(user) ? "조회 전용 계정 — 제어 권한이 없습니다"
          : !growbedId ? "제어 대상 재배공간을 확인할 수 없습니다 — 센서의 소속을 설정에서 지정하세요"
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
            // 센서는 자기 연결 레코드가 없다 (생육기가 묶어 발행한다). 예전에는 여기서
            // conns["growbed-01"] 을 직접 집었는데, 그러면
            //   · 생육기가 온라인이면 값이 10분째 멎은 센서도 「정상」이 된다
            //     (상태 화면은 같은 센서를 오프라인이라 부른다 — 화면끼리 모순)
            //   · 생육기 id 가 growbed-01 이 아닌 농장에서는 아예 못 찾는다
            // 통신 판정(FR-37)은 monitor.deviceLiveness 한 곳이 갖는다.
            const live = deviceLiveness(
              s.sensor_id, "sensor", conns, sensors, s.parent_device_id,
            );
            const conn = live.state === "unmonitored"
              // 등록은 됐는데 값이 한 번도 오지 않은 센서. 배지를 지우면 정상처럼 보인다.
              ? { sev: "warning", label: "데이터 없음" }
              : CONN_STYLE[live.state];
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
          // 목록의 배지와 같은 판정 — 여기만 다른 근거를 쓰면 같은 센서가 목록에서는
          // 정상, 상세에서는 다른 상태로 보인다
          connState={deviceLiveness(
            selected.sensor_id, "sensor", conns, sensors, selected.parent_device_id,
          ).state}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
