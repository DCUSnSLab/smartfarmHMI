"use client";

/**
 * 정지 UI (FR-35·36) — design-change-spec §1 이원화.
 *
 * - 원격 전체 정지(주황): Cat.2 운전 정지. 발동·해제 모두 웹에서 (admin/manager)
 * - 물리 비상정지(빨강): ISO 13850 안전 기능. **표시 전용 — 해제 버튼 없음**
 * 두 배너는 독립적으로 동시 표시될 수 있다 (겹쳐 쌓인다).
 * 색+도형+문구 병기 — 물리가 상위 심각도라 더 강한 표현 (접근성 §5).
 *
 * 배너는 **표시 전용**이고 발동·해제 조작은 네비의 정지 자리에 둔다 — 정지 중에도
 * 그 자리가 비지 않아 우측 구성이 유지되고, 두 버튼이 같은 치수를 공유한다.
 * 배너는 헤더와 함께 화면에 고정되므로(AppShell) 높이가 곧 본문 손실이다 —
 * 어느 폭에서도 한 줄로 접고 상세는 셰브론으로 펼친다 (비기능 §5 모바일·태블릿).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { CONTROL } from "@/components/ui";
import { FarmSummary, StopState, engageStop, releaseStop, timeAgo } from "@/lib/monitor";

/** 경고 삼각 — 원격 전체 정지 (전달본 원본 path) */
function WarningIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2 2 20h20L12 2z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M12 9v5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="12" cy="17.4" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** 팔각 정지 표지 — 물리 비상정지. 색이 아니라 도형으로 원격과 구분한다 (§5) */
function EstopIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.3 2.5h7.4l5.8 5.8v7.4l-5.8 5.8H8.3l-5.8-5.8V8.3z"
        stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"
      />
      <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** 발동자 표기 — 배너에 이메일 전문을 노출하지 않는다 */
const actor = (v?: string | null) => v?.split("@")[0] || "-";

/**
 * 배너 한 종 — **폭과 무관하게 접힌 상태는 항상 한 줄**이고 상세는 셰브론으로 펼친다.
 *
 * 폭으로 분기하면(sm: 등) 그 경계 바로 위 폭에서 긴 문구가 다시 2~3줄로 늘어나고,
 * 경계에서 높이·글자·버튼 크기가 한꺼번에 점프해 보인다.
 * 넘침은 제목 truncate 로만 흡수한다 — 글자 크기를 키워도 줄이 늘지 않는다.
 */
function Banner({
  bar, icon, title, meta, detail,
}: {
  bar: string;
  icon: React.ReactNode;
  title: string;                 // 넘치면 말줄임되는 부분
  meta: string;                  // 항상 보여야 하는 짧은 값 (경과 시간)
  detail: React.ReactNode;
}) {
  // 처음 뜰 때는 펼친다 — 정지가 걸린 순간에는 어느 현장·왜 멈췄는지가 바로 보여야 한다.
  // 그 뒤 접는 선택은 사용자가 하고, 배너가 살아 있는 동안 그 선택을 유지한다
  const [open, setOpen] = useState(true);

  return (
    <div className={`text-white ${bar}`}>
      {/* 폭에 따른 크기·여백 분기를 두지 않는다 — 경계에서 높이·글자·버튼이 한꺼번에
          점프해 보인다. 넘침은 제목 truncate 로만 흡수한다.
          컨테이너·행 높이(CONTROL)는 헤더 행과 같은 값 — 두 바의 높이와 좌측 시작선이 맞는다 */}
      <div className="mx-auto max-w-7xl px-6 py-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 shrink-0 items-center">{icon}</span>

          {/* 경과 시간은 제목 바로 뒤 — 간격은 공백 1칸 수준(gap-1).
              **글자 크기를 제목과 같게 둔다**: 크기가 다르면 줄 상자 높이도 달라
              글자 중심이 어긋나고, 그 오차가 배율마다 변한다. 위계는 굵기와 밝기로 준다 */}
          <span className="mr-auto flex min-w-0 shrink items-center gap-1.5 text-14 font-extrabold">
            <span className="min-w-0 truncate">{title}</span>
            {/* 굵기까지 같게 둔다 — 같은 크기라도 굵기가 다르면 획이 두꺼워 더 커 보인다.
                위계는 밝기만으로 준다 */}
            <span className="shrink-0 text-white/70">{meta}</span>
          </span>

          {/* 배너는 표시 전용 — 해제는 네비의 정지 버튼 자리에 둔다 (StopRelease).
              그래서 두 배너의 구조가 같아지고 제목 가용 폭·경과 시간 위치가 자동으로 맞는다 */}
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "정지 상세 닫기" : "정지 상세 보기"}
            className={`${CONTROL} w-9 justify-center border border-white/40 bg-white/15`}
          >
            {/* 셰브론 — 디자인 전달본(.dc.html) FAQ 원본 path.
                전환 없이 즉시 뒤집는다 — 애니메이션을 걸면 반복 클릭 시 중간 각도에서
                다시 시작해 기울어진 상태로 보인다. 각도는 항상 0 또는 180 */}
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
              className={open ? "rotate-180" : ""}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {open && (
          <div className="mt-2 pb-1 text-12.5 font-semibold leading-relaxed text-white/85">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function StopButton({ canStop, short }: {
  canStop: boolean;
  short: boolean;   // 헤더의 압축 단계 — 폭이 모자랄 때 라벨을 줄인다
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canStop) return null;
  return (
    <>
      {/* 라벨은 헤더의 실측 압축 단계에 따라 줄인다 — 뷰포트 분기(sm:)로 두면 여백이
          남는데도 바뀌거나, 큰글씨에서 모자라도 안 바뀐다.
          전체 명칭은 aria-label 과 확인 모달이 유지한다 */}
      <button
        onClick={() => { setErr(null); setConfirming(true); }}
        aria-label="원격 전체 정지"
        className={`${CONTROL} gap-1.5 border-[1.5px] border-status-warning bg-status-warning/10 px-4 font-extrabold text-status-warningDark`}
      >
        <WarningIcon />
        {short ? "정지" : "원격 전체 정지"}
      </button>

      {/* 헤더의 backdrop-blur 가 fixed 의 컨테이닝 블록이 되어 inset-0 이 헤더 박스(높이 약
          56px)를 가리킨다 — body 로 portal 해야 뷰포트 기준이 된다.
          confirming 은 클릭 이후에만 true 라 SSR 경로에서 document 에 닿지 않는다 */}
      {confirming && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-[20px] bg-status-warning/10 text-status-warningDark">
              <WarningIcon size={36} />
            </div>
            <h2 className="mb-2 text-22 font-extrabold">원격 전체 정지를 실행할까요?</h2>
            <p className="mb-6 text-14.5 font-semibold leading-relaxed text-gray-600">
              전 농장의 <b>모든 로봇·설비 작동이 즉시 중단</b>됩니다.<br />
              자동 스케줄과 원격 제어도 해제 전까지 차단돼요.<br />
              <span className="text-12.5 text-muted">(운전 정지 — 현장 비상정지와는 다른 기능입니다)</span>
            </p>
            {err && (
              <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-13.5 font-bold text-status-warningDark">
                {err}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-2xl bg-gray-100 py-3.5 text-16 font-extrabold text-gray-600"
              >
                취소
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const failed = await engageStop("웹 발동");
                  setBusy(false);
                  setErr(failed);
                  if (!failed) setConfirming(false);  // 실패하면 닫지 않는다 — 성공과 구분돼야 한다
                }}
                className="flex-1 rounded-2xl bg-status-warningDark py-3.5 text-16 font-extrabold text-white disabled:opacity-60"
              >
                {busy ? "실행 중…" : "원격 전체 정지 실행"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** 정지 배너 2종 — 표시 전용. 해제 조작은 네비의 StopRelease 가 담당한다 */
export function StopBanners({ stops, farms }: { stops: StopState; farms: FarmSummary[] }) {
  // 물리 비상정지는 농장별로 독립 성립하고 **모든 화면에 표시**한다 (안전 기능).
  // 어느 현장으로 가야 하는지 알려야 하므로 농장명을 문구에 넣는다 — 이름을 못 찾으면
  // farm_id 로 대신한다 (미등록 농장에서도 정지는 성립할 수 있음)
  const estopFarms = (stops.physical_estop?.farm_ids ?? []).map(
    (id) => farms.find((f) => f.farm_id === id)?.name ?? id,
  );

  return (
    <>
      {/* 물리 비상정지 — 상위 심각도(적색 실선 강조), 해제 경로 없음 */}
      {stops.physical_estop && (
        <Banner
          bar="bg-gradient-to-r from-[#D32030] to-status-warning"
          icon={<EstopIcon size={20} />}
          title={
            estopFarms.length > 1
              ? `현장 비상정지 작동됨 · ${estopFarms.length}곳`
              : "현장 비상정지 작동됨"
          }
          meta={timeAgo(stops.physical_estop.engaged_at)}
          detail={
            <>
              {/* 농장명을 나열하므로 개수가 늘어도 문장이 자연스럽다. 개수 자체는 제목에 */}
              {estopFarms.length > 0 && (
                <>
                  <span className="font-extrabold text-white">{estopFarms.join(" · ")}</span>
                  에서 작동했습니다.{" "}
                </>
              )}
              현장에서 수동 조작으로만 제어가 가능하며, 웹에서는 해제할 수 없습니다.
              (ISO 13850).
            </>
          }
        />
      )}

      {/* 원격 전체 정지 — 웹 해제 가능 */}
      {stops.remote && (
        <Banner
          bar="bg-gradient-to-r from-[#E07800] to-status-caution"
          icon={<WarningIcon size={20} />}
          // 「전체정지」 붙여 씀 — 물리 배너 제목과 폭을 같게 맞춘 것 (정식 명칭은 모달·aria)
          title="원격 전체정지 발동됨"
          meta={timeAgo(stops.remote.engaged_at)}
          detail={
            <>
              전 농장의 모든 로봇·설비 작동이 중단되었습니다. 안전이 확인되면 상단
              「정지 해제」로 해제하세요 — 해제 전까지 자동 스케줄과 원격 제어가
              차단됩니다 · {actor(stops.remote.by)} 발동
            </>
          }
        />
      )}
    </>
  );
}

/**
 * 정지 해제 — **발동 버튼과 같은 자리**(네비 우측)에 둔다.
 *
 * 배너에 두면 (1) 배너 높이·폭 압박이 커지고 (2) 정지 중 네비의 정지 자리가 비어
 * 우측 구성이 무너지며 (3) 두 버튼의 폭을 맞추려 실측값을 박아야 한다.
 * 같은 자리에 두면 CONTROL 치수를 공유하므로 정렬 문제가 생기지 않는다.
 *
 * 해제도 확인 절차를 거친다 — 발동은 기계를 멈추지만 **해제는 다시 움직이게 하므로**
 * 오조작 위험이 더 크다 (design-change-spec §1 「안전이 확인되면 해제」).
 */
export function StopRelease({ canRelease, estopActive, short }: {
  canRelease: boolean;
  estopActive: boolean;   // 현장 비상정지 동시 성립 — 해제 범위를 오해하지 않게 안내한다
  short: boolean;         // 헤더의 압축 단계
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canRelease) return null;
  return (
    <>
      {/* 라벨 축약 기준은 발동 버튼과 동일 */}
      <button
        onClick={() => { setErr(null); setConfirming(true); }}
        aria-label="원격 정지 해제"
        className={`${CONTROL} gap-1.5 border-[1.5px] border-status-caution bg-status-caution/10 px-4 font-extrabold text-status-cautionDark`}
      >
        <WarningIcon />
        {short ? "해제" : "원격 정지 해제"}
      </button>

      {confirming && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-[68px] w-[68px] items-center justify-center rounded-[20px] bg-status-caution/10 text-status-cautionDark">
              <WarningIcon size={36} />
            </div>
            <h2 className="mb-2 text-22 font-extrabold">원격 전체 정지를 해제할까요?</h2>
            <p className="mb-6 text-14.5 font-semibold leading-relaxed text-gray-600">
              해제하면 <b>로봇·설비가 다시 작동</b>하고 자동 스케줄이 재개됩니다.<br />
              <b>현장 안전을 확인한 뒤</b> 해제하세요.
              {estopActive && (
                <>
                  <br />
                  <span className="text-12.5 text-muted">
                    현장 비상정지는 이 조작으로 풀리지 않습니다
                  </span>
                </>
              )}
            </p>
            {err && (
              <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-13.5 font-bold text-status-warningDark">
                {err}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-2xl bg-gray-100 py-3.5 text-16 font-extrabold text-gray-600"
              >
                취소
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const failed = await releaseStop();
                  setBusy(false);
                  setErr(failed);
                  if (!failed) setConfirming(false);  // 실패하면 닫지 않는다 — 배너가 남아 성공과 구분 안 됨
                }}
                className="flex-1 rounded-2xl bg-status-cautionDark py-3.5 text-16 font-extrabold text-white disabled:opacity-60"
              >
                {busy ? "해제 중…" : "정지 해제"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
