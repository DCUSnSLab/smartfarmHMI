"use client";

/**
 * 농장 상세 · 로봇 (디자인 "농장 상세: 로봇").
 * 로봇 카드(위치·속도·전원·임무) + 수동 제어 모달 · 임무 스케줄(Planned) · 작업 로그(Planned)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import { Card, Modal, SectionTitle, StatusDot } from "@/components/ui";
import { CONN_STYLE, PHASE_LABEL } from "@/lib/severity";
import { canControl, useUser } from "@/lib/auth";
import { useFarmData } from "@/lib/farmData";
import { controlBlocked, edgeConn, JOG_REPEAT_MS, JogDirection, postJog, RobotValue, timeAgo } from "@/lib/monitor";

/** 완충 예상 — 충전 중일 때만 (디자인 "완충 예상 42분"). 단순 선형 추정 */
function chargeEta(r: RobotValue): string | null {
  if (!r.charging || r.battery_pct == null) return null;
  const remain = 100 - r.battery_pct;
  return remain <= 0 ? "완충" : `약 ${Math.max(1, Math.round(remain * 0.7))}분`;
}

const JOG_KEYS: { dir: JogDirection; glyph: string; cell: number }[] = [
  { dir: "forward", glyph: "↑", cell: 1 },
  { dir: "left", glyph: "←", cell: 3 },
  { dir: "right", glyph: "→", cell: 5 },
  { dir: "backward", glyph: "↓", cell: 7 },
];

/**
 * 이동 조작 패드 (개정 0.3-robot-jog) — 누르고 있는 동안 반복 발행, 떼면 정지.
 *
 * 떼는 순간을 놓치는 경로가 여럿이다: 포인터가 패드 밖에서 떨어지거나, 탭이
 * 가려지거나, 모달이 닫히거나. 놓쳐도 엣지의 데드맨이 세우지만, 그건 최후의
 * 보루지 정상 경로가 아니다 (개정 §3.1).
 */
function JogPad({
  farmId, deviceId, disabled,
}: { farmId: string; deviceId: string; disabled: boolean }) {
  const [active, setActive] = useState<JogDirection | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef<JogDirection | null>(null);

  const release = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (!activeRef.current) return;
    activeRef.current = null;
    setActive(null);
    void postJog(farmId, deviceId, "stop");
  }, [farmId, deviceId]);

  const press = (dir: JogDirection) => {
    if (disabled || activeRef.current) return;
    activeRef.current = dir;
    setActive(dir);
    void postJog(farmId, deviceId, dir);
    timer.current = setInterval(() => void postJog(farmId, deviceId, dir), JOG_REPEAT_MS);
  };

  useEffect(() => {
    if (!active) return;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [active, release]);

  useEffect(() => release, [release]);  // 언마운트(모달 닫힘) 시에도 세운다

  const cellClass = (on: boolean) =>
    `flex h-11 items-center justify-center rounded-xl text-15 font-extrabold transition ${
      disabled
        ? "bg-gray-100 text-gray-300"
        : on
          ? "bg-primary text-white"
          : "bg-gray-100 text-gray-600 active:bg-primary active:text-white"
    }`;

  return (
    <div className="mb-4 rounded-2xl border border-gray-200 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-13 font-extrabold text-gray-500">이동 조작</span>
        <span className="text-11.5 font-semibold text-gray-400">누르고 있는 동안 이동합니다</span>
      </div>
      <div className="mx-auto grid w-40 grid-cols-3 gap-1.5">
        {Array.from({ length: 9 }, (_, i) => {
          const key = JOG_KEYS.find((k) => k.cell === i);
          if (i === 4) {
            return (
              <button
                key={i} type="button" disabled={disabled} onClick={release}
                title="즉시 정지"
                className={`flex h-11 items-center justify-center rounded-xl text-15 font-extrabold ${
                  disabled
                    ? "bg-gray-100 text-gray-300"
                    : "bg-status-warning/10 text-status-warningDark active:bg-status-warning/25"
                }`}
              >
                ■
              </button>
            );
          }
          if (!key) return <span key={i} />;
          return (
            <button
              key={i} type="button" disabled={disabled}
              onPointerDown={() => press(key.dir)}
              onPointerUp={release}
              onContextMenu={(e) => e.preventDefault()}  // 길게 누르면 뜨는 메뉴가 pointerup 을 삼킨다
              className={cellClass(active === key.dir)}
            >
              {key.glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManualControlModal({
  farmId, robot, onClose, canOperate, blockReason,
}: {
  farmId: string; robot: RobotValue; onClose: () => void;
  canOperate: boolean; blockReason?: string;
}) {
  return (
    <Modal
      title={`${robot.device_id} 수동 제어`}
      sub={PHASE_LABEL[robot.phase] ?? robot.phase}
      onClose={onClose}
      footer={
        <button onClick={onClose} className="w-full rounded-xl bg-primary py-3 text-14 font-extrabold text-white">
          닫기
        </button>
      }
    >
      <div className="mb-4 rounded-xl bg-status-caution/10 px-3 py-2 text-12.5 font-bold text-status-cautionDark">
        이동 조작을 시작하면 진행 중인 임무가 취소됩니다 (개정 0.3-robot-jog §3.3)
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-12 font-bold text-gray-500">배터리</div>
          <div className="text-20 font-extrabold">{robot.battery_pct ?? "—"}%</div>
        </div>
        <div>
          <div className="text-12 font-bold text-gray-500">이동 속도</div>
          <div className="text-20 font-extrabold">{robot.speed?.toFixed(1) ?? "—"}㎧</div>
        </div>
        <div>
          <div className="text-12 font-bold text-gray-500">현재 위치</div>
          <div className="text-15 font-extrabold">
            ({robot.pos_x?.toFixed(1) ?? "—"}, {robot.pos_y?.toFixed(1) ?? "—"})
          </div>
        </div>
      </div>

      <JogPad farmId={farmId} deviceId={robot.device_id} disabled={!canOperate} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled title="자동 충전 지시는 개발 예정입니다 (FR-06)"
          className="flex-1 rounded-xl bg-gray-100 py-3 text-13.5 font-extrabold text-gray-400"
        >
          충전 스테이션 복귀
        </button>
        <PlannedChip basis="FR-06" />
      </div>

      {!canOperate && blockReason && (
        <p className="mt-3 text-center text-12 font-semibold text-status-warningDark">{blockReason}</p>
      )}
    </Modal>
  );
}

export default function RobotTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const user = useUser();
  const { robots, conns, stops } = useFarmData();
  const [selected, setSelected] = useState<RobotValue | null>(null);

  const list = Object.values(robots);
  const stopped = controlBlocked(stops, farmId);
  const edge = edgeConn(conns);
  const farmOnline = edge?.state === "online";
  const canOperate = canControl(user) && farmOnline && !stopped;

  return (
    <>
      <section className="mb-6">
        <SectionTitle
          title="로봇" sub={`${list.length}대 · 위치·속도·전원·이상 실시간`}
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {list.map((r) => {
            const c = conns[r.device_id];
            const eta = chargeEta(r);
            const low = (r.battery_pct ?? 100) < 30;
            return (
              <Card key={r.device_id}>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-15.5 font-extrabold">{r.device_id}</span>
                  <span className="rounded-lg bg-primary-bg px-2 py-0.5 text-11.5 font-extrabold text-primary-dark">
                    {PHASE_LABEL[r.phase] ?? r.phase}
                  </span>
                  {/* 오류는 단계를 덮지 않고 나란히 붙는다 — "이동 중 + 경로 실패"가
                      동시에 보여야 어느 구간에서 멈췄는지 알 수 있다 (§4.2). */}
                  {r.error && (
                    <span
                      className="rounded-lg bg-status-warning/15 px-2 py-0.5 text-11.5 font-extrabold text-status-warningDark"
                      title={r.error.message ?? undefined}
                    >
                      이상 · {r.error.code}
                    </span>
                  )}
                  {/* 통신 행이 없으면 배지를 지우던 자리 — 소식이 끊긴 로봇이
                      멀쩡해 보였다. 모른다는 사실도 상태다. */}
                  {(() => {
                    const s = CONN_STYLE[c?.state ?? ""] ?? CONN_STYLE.unknown;
                    return <StatusDot sev={s.sev} label={s.label} />;
                  })()}
                  <span className="ml-auto text-11.5 font-semibold text-muted">{timeAgo(r.ts)}</span>
                </div>

                {/* 큰글씨에서 3열은 「속 도」처럼 라벨이 쪼개진다 — 좁을 때는 2열로 내린다 */}
                <div className="mb-3 grid grid-cols-2 gap-2 text-12.5 font-semibold text-gray-600 sm:grid-cols-3">
                  <div>
                    배터리{" "}
                    <b className={low ? "text-status-warningDark" : ""}>{r.battery_pct ?? "—"}%</b>
                    {r.charging && <span className="ml-1 text-status-infoDark">⚡충전</span>}
                    {eta && <div className="text-11.5 text-muted">완충 예상 {eta}</div>}
                  </div>
                  <div>속도 <b>{r.speed?.toFixed(1) ?? "—"}㎧</b></div>
                  <div>
                    위치 <b>({r.pos_x?.toFixed(1) ?? "—"}, {r.pos_y?.toFixed(1) ?? "—"})</b>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setSelected(r)}
                    className="rounded-xl border border-gray-200 px-3.5 py-2 text-12.5 font-bold text-gray-600"
                  >
                    수동 제어
                  </button>
                  <button
                    disabled title="로봇 영상 조회는 개발 예정입니다 (FR-05)"
                    className="rounded-xl bg-gray-100 px-3.5 py-2 text-12.5 font-bold text-gray-400"
                  >
                    영상
                  </button>
                  <span className="ml-auto self-center"><PlannedChip basis="FR-05 영상" /></span>
                </div>
              </Card>
            );
          })}
          {list.length === 0 && (
            <Card className="lg:col-span-2">
              <div className="text-13 font-semibold text-muted">
                로봇 데이터가 없어요. 장비를 등록하고 엣지가 상태를 발행하면 표시됩니다.
              </div>
            </Card>
          )}
        </div>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlannedBox feature="임무 스케줄 · 운반 경로" basis="증분 8 · FR-03">
          로봇별 시간대 임무(트레이 반출 → 작업 장소 → 반납)를 등록·조회합니다.
          등록 시 로봇·워크스테이션·파레트 3자원의 시간 충돌을 검사하고, 충돌 시
          「기존 삭제 후 추가」 또는 「기존 종료 후로 예약」을 선택합니다.
        </PlannedBox>
        <PlannedBox feature="작업 로그" basis="증분 8 · FR-01">
          단위작업별 성공 여부·작업량·재시도 횟수가 기록되어 조회됩니다.
          (스키마·적재 경로는 준비 완료 — 엣지가 작업 이력을 발행하면 표시)
        </PlannedBox>
      </section>

      {selected && (
        <ManualControlModal
          farmId={farmId} robot={selected} onClose={() => setSelected(null)} canOperate={canOperate}
          blockReason={
            stopped ? "정지 발동 중 — 원격 제어가 차단되었습니다"
            : !farmOnline ? "통신 단절 — 제어를 사용할 수 없습니다"
            : !canControl(user) ? "조회 전용 계정 — 제어 권한이 없습니다"
            : undefined
          }
        />
      )}
    </>
  );
}
