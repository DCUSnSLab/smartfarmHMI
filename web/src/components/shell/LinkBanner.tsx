"use client";

/**
 * 서버 연결 배너 — 화면의 값이 지금 것이 아님을 알린다.
 *
 * 소켓만 보면 절반만 본다. 미들웨어나 브리지가 멈추면 소켓은 붙어 있고 값만
 * 낡는다. 그 상태를 「정상」으로 두면 조용히 멈춘 농장을 정상으로 읽게 된다.
 */

import { LinkState, useServerLink } from "@/lib/monitor";
import { useFarmData } from "@/lib/farmData";

const MESSAGE: Record<Exclude<LinkState, "ok" | "unknown">, string> = {
  "socket-down": "실시간 연결이 끊겼습니다 — 화면의 값은 갱신되지 않습니다",
  "server-down": "서버가 응답하지 않습니다 — 화면의 값은 마지막으로 받은 값입니다",
  silent: "서버에서 신호가 오지 않습니다 — 화면의 값은 마지막으로 받은 값입니다",
};

export function LinkBanner() {
  const { wsOpen, serverBeat } = useFarmData();
  const state = useServerLink(wsOpen, serverBeat);
  if (state === "ok" || state === "unknown") return null;
  return (
    <div
      role="status"
      className="bg-status-warning px-4 py-2 text-center text-12.5 font-extrabold text-white"
    >
      {MESSAGE[state]}
    </div>
  );
}
