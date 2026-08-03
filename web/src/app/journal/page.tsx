"use client";

/**
 * 농업일지 (디자인 "전역: 농업일지") — FR-18 메모 실구현.
 * 달력(메모 도트) · 선택일 일지 · 메모 작성 · 전체 일지 목록
 * 자동 리포트(FR-17)·음성 작성(FR-28)·첨부는 개발 예정.
 */

import { useCallback, useEffect, useState } from "react";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import { Card, SectionTitle } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { canControl, useUser } from "@/lib/auth";
import { useFarmData, useScope } from "@/lib/farmData";

interface Memo {
  id: number;
  farm_id: string;
  memo_date: string;
  body: string;
  via_voice: boolean;
  author: string;
  created_at: string;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function JournalPage() {
  useScope("all");
  const user = useUser();
  const { farms } = useFarmData();

  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string>(iso(today));
  const [memos, setMemos] = useState<Memo[]>([]);
  const [farmId, setFarmId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/memos?month=${monthKey}`);
    if (r.ok) setMemos(await r.json());
  }, [monthKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!farmId && farms.length) setFarmId(farms[0].farm_id); }, [farms, farmId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !farmId) return;
    setBusy(true);
    const r = await apiFetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ farm_id: farmId, memo_date: selected, body }),
    });
    setBusy(false);
    if (r.ok) { setBody(""); void load(); }
  };

  const remove = async (id: number) => {
    if (!confirm("이 메모를 삭제할까요?")) return;
    const r = await apiFetch(`/api/memos/${id}`, { method: "DELETE" });
    if (r.ok) void load();
  };

  // 달력 격자
  const firstDow = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const memoDays = new Set(memos.map((m) => m.memo_date));
  const dayMemos = memos.filter((m) => m.memo_date === selected);
  const farmName = (id: string) => farms.find((f) => f.farm_id === id)?.name ?? id;

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[22px] font-extrabold">농업일지</h1>
        <span className="text-[13px] font-semibold text-muted">
          날짜를 선택해 메모를 작성하고 기록을 확인해요
        </span>
      </div>

      <section className="mb-5">
        <PlannedBox feature="자동 리포트 (일간·주간·월간·년간)" basis="FR-17 · 통계 엔진">
          통계 데이터를 바탕으로 리포트가 자동 생성되어 메모와 함께 날짜별로 표시됩니다.
        </PlannedBox>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 달력 */}
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="h-8 w-8 rounded-lg bg-surface text-[14px] font-extrabold text-gray-500"
              aria-label="이전 달"
            >‹</button>
            <span className="text-[15px] font-extrabold">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </span>
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="h-8 w-8 rounded-lg bg-surface text-[14px] font-extrabold text-gray-500"
              aria-label="다음 달"
            >›</button>
            <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> 메모 있음
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK.map((w) => (
              <span key={w} className="py-1 text-[11.5px] font-extrabold text-muted">{w}</span>
            ))}
            {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
              const date = iso(new Date(month.getFullYear(), month.getMonth(), d));
              const isToday = date === iso(today);
              const isSel = date === selected;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(date)}
                  className={`flex h-11 flex-col items-center justify-center rounded-xl text-[13.5px] font-bold ${
                    isSel ? "bg-primary text-white"
                    : isToday ? "bg-primary-bg text-primary-dark"
                    : "text-gray-700 hover:bg-surface"
                  }`}
                >
                  {d}
                  <span className="mt-0.5 h-1.5">
                    {memoDays.has(date) && (
                      <span className={`block h-1.5 w-1.5 rounded-full ${isSel ? "bg-white" : "bg-primary"}`} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* 선택일 일지 */}
        <Card>
          <SectionTitle title={`${selected} 일지`} sub={`메모 ${dayMemos.length}건`} />
          <div className="space-y-2">
            {dayMemos.map((m) => (
              <div key={m.id} className="rounded-xl bg-surface p-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-md bg-primary-bg px-1.5 py-0.5 text-[11px] font-extrabold text-primary-dark">
                    {farmName(m.farm_id)}
                  </span>
                  <span className="text-[11.5px] font-semibold text-muted">{m.author}</span>
                  <button
                    onClick={() => void remove(m.id)}
                    className="ml-auto text-[11.5px] font-bold text-gray-400"
                  >
                    삭제
                  </button>
                </div>
                <p className="text-[13.5px] font-semibold leading-relaxed text-gray-700">{m.body}</p>
              </div>
            ))}
            {dayMemos.length === 0 && (
              <div className="py-6 text-center text-[13px] font-semibold text-muted">
                이 날짜에 등록된 일지가 없어요. 아래에서 메모를 작성해 보세요.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* 메모 작성 */}
      <section className="mb-5">
        <Card>
          <SectionTitle title="메모 작성" sub={`${selected} 기준`} />
          {canControl(user) ? (
            <form onSubmit={save}>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {farms.map((f) => (
                  <button
                    key={f.farm_id} type="button" onClick={() => setFarmId(f.farm_id)}
                    className={`rounded-xl border px-3 py-1.5 text-[12.5px] ${
                      farmId === f.farm_id
                        ? "border-primary bg-primary-bg font-extrabold text-primary-dark"
                        : "border-gray-200 font-bold text-gray-500"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <textarea
                value={body} onChange={(e) => setBody(e.target.value)} rows={3}
                placeholder="메모를 입력하세요…"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-[13.5px] font-semibold outline-none focus:border-primary"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button" disabled title="음성 작성은 개발 예정입니다 (FR-28)"
                  className="rounded-xl bg-gray-100 px-3.5 py-2 text-[12.5px] font-bold text-gray-400"
                >
                  🎤 음성으로 작성
                </button>
                <button
                  type="button" disabled title="사진·동영상 첨부는 개발 예정입니다 (FR-18)"
                  className="rounded-xl bg-gray-100 px-3.5 py-2 text-[12.5px] font-bold text-gray-400"
                >
                  📎 첨부
                </button>
                <PlannedChip basis="FR-28 음성 · FR-18 첨부" />
                <button
                  type="submit" disabled={busy || !body.trim()}
                  className="ml-auto rounded-xl bg-primary px-5 py-2 text-[13.5px] font-extrabold text-white disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {busy ? "저장 중…" : "저장"}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-[13px] font-semibold text-muted">
              조회 전용 계정 — 메모 작성 권한이 없습니다.
            </p>
          )}
        </Card>
      </section>

      {/* 전체 일지 */}
      <section>
        <SectionTitle title="전체 일지" sub={`${monthKey} · ${memos.length}건`} />
        <div className="rounded-2xl bg-white p-2 shadow-sm">
          {memos.map((m) => (
            <button
              key={m.id} onClick={() => setSelected(m.memo_date)}
              className="flex w-full items-start gap-3 border-b border-gray-50 px-3 py-3 text-left last:border-0 hover:bg-surface"
            >
              <span className="w-16 flex-none text-[12px] font-extrabold text-muted">
                {m.memo_date.slice(5)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mr-1.5 rounded-md bg-primary-bg px-1.5 py-0.5 text-[11px] font-extrabold text-primary-dark">
                  {farmName(m.farm_id)}
                </span>
                <span className="text-[13.5px] font-semibold text-gray-700">{m.body}</span>
              </span>
              <span className="flex-none text-[11.5px] font-semibold text-muted">{m.author}</span>
            </button>
          ))}
          {memos.length === 0 && (
            <div className="py-8 text-center text-[13px] font-semibold text-muted">
              이번 달 메모가 없어요
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
