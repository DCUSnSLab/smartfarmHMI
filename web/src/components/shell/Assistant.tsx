"use client";

/**
 * 음성·도움 어시스턴트 (디자인 "좌하단 음성·도움 어시스턴트 — 전역 고정").
 *
 * FR-27·30: 음성 인식 엔진·LLM 은 개발 범위 밖이다. UI 와 텍스트 폴백만 제공하고
 * 미연동 시 정적 안내로 응답한다 — 요구사항이 명시한 폴백 동작을 그대로 구현.
 */

import { useState } from "react";
import { PlannedChip } from "@/components/Planned";

interface Msg { role: "user" | "bot"; text: string }

const GREETING =
  '안녕하세요, 팜온 도우미예요. 음성 엔진이 연결되지 않아 텍스트로 안내드립니다. ' +
  '"온도", "알림", "정지" 같은 단어로 물어보세요.';

/** 정적 안내 응답 (LLM 미연동 폴백 — FR-30) */
function staticAnswer(q: string): string {
  const t = q.toLowerCase();
  if (/온도|습도|센서|환경/.test(t))
    return "농장 상세 → 「생육기·센서」 탭에서 실시간 환경값과 센서별 상태를 볼 수 있어요. 센서 행을 누르면 24시간 추이도 확인됩니다.";
  if (/제어|설정|목표/.test(t))
    return "「생육기·센서」 탭의 환경 제어에서 온도·습도·양분·LED 목표값을 설정할 수 있어요. 명령은 접수→완료로 상태가 표시됩니다.";
  if (/알림|경고/.test(t))
    return "상단 알림 벨에서 미확인 알림을 확인하고, 항목을 누르면 관련 화면으로 이동합니다. 임계값은 설정 화면에서 조정해요.";
  if (/정지|비상/.test(t))
    return "상단 「원격 전체 정지」는 운전 정지(웹에서 해제 가능)입니다. 현장 비상정지는 표시만 되고 현장에서 직접 해제해야 해요.";
  if (/로봇|충전/.test(t))
    return "「로봇」 탭에서 위치·속도·배터리·임무 상태를 실시간으로 봅니다. 임무 스케줄링은 개발 예정이에요.";
  if (/일지|메모/.test(t))
    return "농업일지에서 날짜를 선택해 메모를 작성할 수 있어요. 자동 리포트와 음성 작성은 개발 예정입니다.";
  return "죄송해요, 아직 답할 수 없는 질문이에요. 음성 인식·LLM 연동 후 더 많은 질문에 답할 수 있습니다. 지원 화면의 FAQ도 참고해 주세요.";
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "bot", text: GREETING }]);
  const [input, setInput] = useState("");

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "bot", text: staticAnswer(q) }]);
    setInput("");
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label="음성·도움 어시스턴트"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-22 text-white shadow-lg"
      >
        {open ? "×" : "💬"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-40 flex max-h-[70vh] w-[min(380px,calc(100vw-3rem))] flex-col rounded-2xl bg-white shadow-xl ring-1 ring-gray-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <span className="text-14.5 font-extrabold">음성·도움 어시스턴트</span>
            <PlannedChip basis="FR-27·30 엔진 미연동" />
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-13 font-semibold leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-white"
                    : "bg-surface text-gray-700"
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>

          <form onSubmit={send} className="flex gap-2 border-t border-gray-100 p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지 입력…"
              className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-13 font-semibold outline-none focus:border-primary"
            />
            <button
              type="button" disabled title="음성 인식 엔진 미연동 (FR-27)"
              className="rounded-xl bg-gray-100 px-3 text-13 font-bold text-gray-400"
            >
              🎤
            </button>
            <button type="submit" className="rounded-xl bg-primary px-3 text-13 font-extrabold text-white">
              전송
            </button>
          </form>
        </div>
      )}
    </>
  );
}
