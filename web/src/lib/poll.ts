"use client";

import { useEffect, useRef } from "react";

/**
 * 탭이 보일 때만 도는 주기 실행.
 *
 * 감시 화면은 하루 종일 열어 두는 탭이라, 안 보는 동안 나가는 요청이 그대로 낭비다.
 * 숨으면 멈추고 다시 보이면 즉시 한 번 실행해 밀린 값을 메운다 — 돌아왔을 때
 * 옛 값이 남아 있으면 「지금 상태」로 오해한다.
 *
 * run 은 매 렌더 새로 만들어져도 된다 (ref 로 잡아 타이머를 다시 걸지 않는다).
 * 비동기 run 의 실패는 여기서 흡수한다 (아래 fire 참고).
 */
export function useVisiblePolling(
  run: () => void | Promise<void>, intervalMs: number, enabled = true,
) {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    // 폴링은 실패해도 다음 주기에 다시 시도한다. 처리되지 않은 거부로 남기면
    // 일시적 네트워크 장애(배포 중 게이트웨이 재시작 등)마다 개발 오버레이가 뜬다.
    const fire = () => {
      try {
        void Promise.resolve(runRef.current()).catch(() => {});
      } catch {
        /* 동기 예외도 같은 이유로 흡수한다 */
      }
    };
    const start = () => {
      if (timer !== undefined) return;   // 이미 돌고 있으면 주기를 새로 잡지 않는다
      fire();
      timer = setInterval(fire, intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
