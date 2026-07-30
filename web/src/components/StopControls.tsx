"use client";

/**
 * 정지 UI (FR-35·36) — design-change-spec §1 이원화.
 *
 * - 원격 전체 정지(주황): Cat.2 운전 정지. 발동·해제 모두 웹에서 (admin/manager)
 * - 물리 비상정지(빨강): ISO 13850 안전 기능. **표시 전용 — 해제 버튼 없음**
 * 두 배너는 독립적으로 동시 표시될 수 있다. 색+도형+문구 병기 (접근성 §5).
 */

import { useState } from "react";
import { StopState, engageStop, releaseStop, timeAgo } from "@/lib/monitor";

export function StopButton({ canStop }: { canStop: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canStop) return null;
  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="rounded-xl border-[1.5px] border-status-warning bg-status-warning/10 px-4 py-1.5 text-[13.5px] font-extrabold text-status-warningDark"
      >
        ■ 원격 전체 정지
      </button>

      {confirming && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-status-warning/10 text-3xl">⚠️</div>
            <h2 className="mb-2 text-[20px] font-extrabold">원격 전체 정지를 실행할까요?</h2>
            <p className="mb-6 text-[14px] font-semibold leading-relaxed text-gray-600">
              전 농장의 <b>모든 로봇·설비 작동이 중단</b>됩니다.<br />
              자동 스케줄과 원격 제어도 해제 전까지 차단돼요.<br />
              <span className="text-[12.5px] text-muted">(운전 정지 — 현장 비상정지와는 다른 기능입니다)</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-xl bg-gray-100 py-3.5 text-[15px] font-extrabold text-gray-600"
              >
                취소
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await engageStop("웹 발동");
                  setBusy(false);
                  setConfirming(false);
                }}
                className="flex-1 rounded-xl bg-status-warningDark py-3.5 text-[15px] font-extrabold text-white disabled:opacity-60"
              >
                {busy ? "실행 중…" : "원격 전체 정지 실행"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function StopBanners({ stops, canRelease }: { stops: StopState; canRelease: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="sticky top-0 z-40">
      {/* 물리 비상정지 — 상위 심각도, 해제 경로 없음 */}
      {stops.physical_estop && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#D32030] to-status-warning px-6 py-3.5 text-white">
          <span className="text-xl">🛑</span>
          <div className="flex-1">
            <div className="text-[15px] font-extrabold">
              현장 비상정지 작동됨 — 현장에서 직접 해제해야 합니다
            </div>
            <div className="text-[12.5px] font-semibold opacity-90">
              웹에서 해제할 수 없습니다 (ISO 13850) · 작동 {timeAgo(stops.physical_estop.engaged_at)}
            </div>
          </div>
        </div>
      )}
      {/* 원격 전체 정지 — 웹 해제 가능 */}
      {stops.remote && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-[#E07800] to-status-caution px-6 py-3.5 text-white">
          <span className="text-xl">■</span>
          <div className="flex-1">
            <div className="text-[15px] font-extrabold">
              원격 전체 정지 발동 중 — 자동 스케줄·원격 제어 차단
            </div>
            <div className="text-[12.5px] font-semibold opacity-90">
              발동 {stops.remote.by ?? "-"} · {timeAgo(stops.remote.engaged_at)}
            </div>
          </div>
          {canRelease && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await releaseStop();
                setBusy(false);
              }}
              className="rounded-xl bg-white px-4 py-2 text-[13.5px] font-extrabold text-[#E07800] disabled:opacity-60"
            >
              {busy ? "해제 중…" : "원격 정지 해제"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
