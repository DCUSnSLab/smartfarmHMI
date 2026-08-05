"use client";

/**
 * 정지 UI (FR-35·36) — design-change-spec §1 이원화.
 *
 * - 원격 전체 정지(주황): Cat.2 운전 정지. 발동·해제 모두 웹에서 (admin/manager)
 * - 물리 비상정지(빨강): ISO 13850 안전 기능. **표시 전용 — 해제 버튼 없음**
 * 두 배너는 독립적으로 동시 표시될 수 있다 (겹쳐 쌓인다).
 * 색+도형+문구 병기 — 물리가 상위 심각도라 더 강한 표현 (접근성 §5).
 *
 * 배너는 헤더와 함께 화면에 고정되므로(AppShell) 높이가 곧 본문 손실이다.
 * 좁은 폭에서는 한 줄로 접고 상세를 「자세히」로 펼친다 (비기능 §5 모바일·태블릿).
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { CONTROL } from "@/components/ui";
import { StopState, engageStop, releaseStop, timeAgo } from "@/lib/monitor";

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

/** 해제 버튼의 상자 — 아래 자리끼움도 같은 값을 쓰므로 두 배너의 제목 가용 폭이 같아진다 */
const RELEASE_BOX = `${CONTROL} justify-center border font-extrabold`;

/**
 * 헤더 사용자 버튼과 폭을 맞춘다 — 두 바에서 세로로 겹치는 자리라 어긋나면 눈에 띈다.
 *
 * 사용자 버튼은 내용 크기이고, 그 구성이 **rem(배율 영향)과 px(고정)의 혼합**이다:
 *   좌우 여백 px-3 + 간격 gap-1.5 = 1.875rem  (가 큰글씨 3단계에 따라 커짐)
 *   아이콘 17px + 이름 13.5px 글자 + 테두리    = 59.1px (고정)
 * 그래서 한쪽만 rem 이나 px 로 박으면 다른 배율에서 어긋난다 — 실측 89.1px(배율 1.0)
 * / 97.5px(배율 1.28) 이 그 차이다. 같은 식으로 두면 모든 단계에서 일치한다.
 *
 * minWidth 를 함께 지정해야 한다: flex 항목의 `min-width: auto` 가 내용 최소 폭을
 * 하한으로 삼아, width 만 주면 긴 라벨이 지정 폭을 밀어낸다.
 * 인라인 스타일인 이유는 calc 조합을 Tailwind 임의값으로 두면 가독성이 떨어지기 때문.
 */
const RELEASE_W = {
  width: "calc(59.1px + 1.875rem)",
  minWidth: "calc(59.1px + 1.875rem)",
} as const;

/** 발동자 표기 — 배너에 이메일 전문을 노출하지 않는다 */
const actor = (v?: string | null) => v?.split("@")[0] || "-";

/**
 * 배너 한 종 — **폭과 무관하게 접힌 상태는 항상 한 줄**이고 상세는 셰브론으로 펼친다.
 *
 * 폭으로 분기하면(sm: 등) 그 경계 바로 위 폭에서 긴 문구가 다시 2~3줄로 늘어난다.
 * 배너는 헤더와 함께 고정되므로 높이가 곧 본문 손실이라, 어느 폭에서도 한 줄을 유지한다.
 * 제목은 truncate — 글자 크기를 키워도 줄이 늘지 않는다.
 */
function Banner({
  bar, icon, title, meta, detail, action,
}: {
  bar: string;
  icon: React.ReactNode;
  title: string;                 // 넘치면 말줄임되는 부분
  meta: string;                  // 항상 보여야 하는 짧은 값 (경과 시간)
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`text-white ${bar}`}>
      {/* 폭에 따른 크기·여백 분기를 두지 않는다 — 경계에서 높이·글자·버튼이 한꺼번에
          점프해 보인다. 넘침은 제목 truncate 로만 흡수한다.
          컨테이너·행 높이(CONTROL)는 헤더 행과 같은 값 — 두 바의 높이와 좌측 시작선이 맞는다 */}
      <div className="mx-auto max-w-7xl px-6 py-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 shrink-0 items-center">{icon}</span>

          {/* 경과 시간은 제목 바로 뒤 — 간격은 공백 1칸 수준(gap-1) */}
          <span className="mr-auto flex min-w-0 shrink items-center gap-1">
            <span className="min-w-0 truncate text-[14px] font-extrabold">
              {title}
            </span>
            <span className="shrink-0 text-[13px] font-semibold opacity-90">{meta}</span>
          </span>

          {/* 우측 그룹 — 간격을 헤더 우측 그룹(gap-2)과 같게 둬야 해제 버튼과
              사용자 버튼의 좌우 위치가 맞는다. 폭만 같고 간격이 다르면 어긋난다 */}
          <span className="flex shrink-0 items-center gap-2">
            {/* 해제 버튼이 없는 배너에는 같은 상자를 투명하게 둔다 — 두 배너의 제목
                가용 폭이 같아져 좁은 폭에서 말줄임 시점과 경과 시간 위치가 어긋나지 않는다 */}
            {action ?? (
              <span aria-hidden="true" style={RELEASE_W} className={`${RELEASE_BOX} invisible`}>
                정지 해제
              </span>
            )}

            {/* 펼침 버튼은 두 배너 모두 맨 오른쪽 — 배너 종류에 따라 위치가 흔들리지 않는다 */}
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
          </span>
        </div>

        {open && (
          <div className="pb-1 text-[12.5px] font-semibold leading-relaxed opacity-95">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function StopButton({ canStop }: { canStop: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canStop) return null;
  return (
    <>
      <button
        onClick={() => { setErr(null); setConfirming(true); }}
        className={`${CONTROL} gap-1.5 border-[1.5px] border-status-warning bg-status-warning/10 px-4 font-extrabold text-status-warningDark`}
      >
        <WarningIcon />
        원격 전체 정지
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
            <h2 className="mb-2 text-[22px] font-extrabold">원격 전체 정지를 실행할까요?</h2>
            <p className="mb-6 text-[14.5px] font-semibold leading-relaxed text-gray-600">
              전 농장의 <b>모든 로봇·설비 작동이 즉시 중단</b>됩니다.<br />
              자동 스케줄과 원격 제어도 해제 전까지 차단돼요.<br />
              <span className="text-[12.5px] text-muted">(운전 정지 — 현장 비상정지와는 다른 기능입니다)</span>
            </p>
            {err && (
              <p className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-[13.5px] font-bold text-status-warningDark">
                {err}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-2xl bg-gray-100 py-3.5 text-[16px] font-extrabold text-gray-600"
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
                className="flex-1 rounded-2xl bg-status-warningDark py-3.5 text-[16px] font-extrabold text-white disabled:opacity-60"
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

export function StopBanners({ stops, canRelease }: { stops: StopState; canRelease: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <>
      {/* 물리 비상정지 — 상위 심각도(적색 실선 강조), 해제 경로 없음 */}
      {stops.physical_estop && (
        <Banner
          bar="bg-gradient-to-r from-[#D32030] to-status-warning"
          icon={<EstopIcon size={20} />}
          title="현장 비상정지 작동됨"
          meta={timeAgo(stops.physical_estop.engaged_at)}
          detail="현장에서 의도적인 수동 조작으로만 리셋됩니다. 웹에서는 해제할 수 없습니다 (ISO 13850)."
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
              전 농장의 모든 로봇·설비 작동이 중단되었습니다. 안전이 확인되면 해제하세요 —
              해제 전까지 자동 스케줄과 원격 제어가 차단됩니다 · {actor(stops.remote.by)} 발동
              {err && ` · ${err}`}
            </>
          }
          action={
            canRelease ? (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErr(await releaseStop());
                  setBusy(false);
                }}
                style={RELEASE_W}
                className={`${RELEASE_BOX} border-[#C05600]/20 bg-white text-[#C05600] disabled:opacity-60`}
              >
                {busy ? "해제 중…" : "정지 해제"}
              </button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
