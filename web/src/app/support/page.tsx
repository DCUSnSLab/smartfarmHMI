"use client";

/**
 * 지원 (디자인 "전역: 지원") — FR-30 도움말.
 * 대화형 도움말(어시스턴트) 안내 · 사용 가이드 · FAQ · 문의
 */

import { useState } from "react";
import { PlannedChip } from "@/components/Planned";
import { Card, SectionTitle } from "@/components/ui";

const GUIDES = [
  {
    title: "대시보드 보기",
    body: "통합 대시보드에서 전체 농장의 상태·로봇·알림을 한눈에 봅니다. 농장 카드를 누르면 해당 농장의 상세(상태·생육기·로봇·작업공급·알림)로 이동합니다.",
  },
  {
    title: "환경 제어하기",
    body: "농장 상세 → 생육기·센서 탭의 환경 제어에서 목표 온도·습도·양분(EC)·LED 밝기를 조절하고 「설정 적용」을 누릅니다. 명령은 접수 → 완료로 상태가 표시되며, 잠시 후 센서값이 목표를 따라 움직입니다.",
  },
  {
    title: "알림 확인·설정",
    body: "상단 알림 벨에서 미확인 알림을 확인합니다. 항목을 누르면 읽음 처리되고 관련 화면으로 이동합니다. 임계값과 알림 종류는 설정 화면에서 조정합니다.",
  },
  {
    title: "정지 사용법",
    body: "상단 「원격 전체 정지」는 운전 정지로, 발동 중 자동 스케줄과 원격 제어가 차단되며 웹에서 해제할 수 있습니다. 현장 비상정지가 작동하면 별도의 붉은 배너로 표시되며, 이는 현장에서 직접 해제해야 합니다.",
  },
  {
    title: "글자 크기 조절",
    body: "상단 「가 −/+」로 글자와 터치 영역을 3단계(표준·크게·아주 크게)로 키울 수 있습니다. 설정은 다음 접속에도 유지됩니다.",
  },
];

const FAQ = [
  {
    q: "원격 전체 정지와 현장 비상정지는 어떻게 다른가요?",
    a: "원격 전체 정지는 웹에서 발동·해제하는 운전 정지(IEC 60204-1 Stop Category 2)로, 안전등급 기능이 아닙니다. 현장 비상정지는 ISO 13850 안전 장치로, 화면에는 상태만 표시되고 해제는 현장에서 직접 수행해야 합니다.",
  },
  {
    q: "자동/수동 제어는 어떻게 전환하나요?",
    a: "현재는 수동 제어(목표값 설정)만 제공합니다. 자동 제어(성장단계별 자동 설정)와 AI 기반 전력효율 제어는 개발 예정입니다.",
  },
  {
    q: "화면의 값이 갱신되지 않아요.",
    a: "상단의 실시간 표시를 확인해 주세요. 「연결 끊김」이면 브라우저를 새로 고침하고, 장치가 「오프라인」이면 엣지 통신을 점검해야 합니다. 통신이 끊기면 마지막 수신 시각이 함께 표시됩니다.",
  },
  {
    q: "「개발 예정」 표시는 무엇인가요?",
    a: "화면 구성은 갖췄지만 기능이 아직 구현되지 않은 부분입니다. 표시 옆의 근거(FR 번호·증분·OPN)로 어느 작업에서 채워질지 확인할 수 있습니다.",
  },
];

export default function SupportPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold">지원</h1>
        <span className="text-[13px] font-semibold text-muted">도움말 · 문의 · 대화형 도움</span>
      </div>

      <section className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[14.5px] font-extrabold">대화형 도움말</span>
            <PlannedChip basis="FR-30 LLM 미연동" />
          </div>
          <p className="text-[12.5px] font-semibold leading-relaxed text-muted">
            우하단의 💬 버튼으로 어시스턴트를 열 수 있어요. 음성 엔진·LLM 이 연결되지 않아
            현재는 텍스트 입력과 정적 안내로 동작합니다.
          </p>
        </Card>
        <Card>
          <div className="mb-1 text-[14.5px] font-extrabold">사용 가이드</div>
          <p className="text-[12.5px] font-semibold leading-relaxed text-muted">
            대시보드·제어·알림·정지 사용법을 아래에서 단계별로 안내합니다.
          </p>
        </Card>
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[14.5px] font-extrabold">1:1 문의</span>
            <PlannedChip basis="문의 채널 미정" />
          </div>
          <p className="text-[12.5px] font-semibold leading-relaxed text-muted">
            기술 지원팀 문의 채널은 준비 중입니다. 당장은 연구실 담당자에게 연락해 주세요.
          </p>
        </Card>
      </section>

      <section className="mb-5">
        <SectionTitle title="사용 가이드" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {GUIDES.map((g) => (
            <Card key={g.title}>
              <div className="mb-1.5 text-[14px] font-extrabold">{g.title}</div>
              <p className="text-[12.5px] font-semibold leading-relaxed text-gray-600">{g.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title="자주 묻는 질문" />
        <div className="rounded-2xl bg-white p-2 shadow-sm">
          {FAQ.map((f, i) => (
            <div key={f.q} className="border-b border-gray-50 last:border-0">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center gap-3 px-3 py-3.5 text-left"
              >
                <span className="flex-1 text-[13.5px] font-bold">{f.q}</span>
                <span className="text-[13px] text-gray-400">{open === i ? "−" : "+"}</span>
              </button>
              {open === i && (
                <p className="px-3 pb-4 text-[13px] font-semibold leading-relaxed text-gray-600">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
