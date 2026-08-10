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
  author_email: string;
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
  const [deletingMemoId, setDeletingMemoId] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [editingMemoId, setEditingMemoId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [memoFarmFilter, setMemoFarmFilter] = useState("all");

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/memos?month=${monthKey}`);
    if (r.ok) setMemos(await r.json());
  }, [monthKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!farms.length) {
      if (farmId) setFarmId("");
      return;
    }
    if (!farms.some((f) => f.farm_id === farmId)) setFarmId(farms[0].farm_id);
  }, [farms, farmId]);
  useEffect(() => {
    if (memoFarmFilter !== "all" && !farms.some((f) => f.farm_id === memoFarmFilter)) {
      setMemoFarmFilter("all");
    }
  }, [farms, memoFarmFilter]);

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

  const remove = async () => {
    if (deletingMemoId === null) return;
    setDeleteBusy(true);
    const r = await apiFetch(`/api/memos/${deletingMemoId}`, { method: "DELETE" });
    setDeleteBusy(false);
    if (r.ok) {
      setDeletingMemoId(null);
      void load();
    }
  };

  const startEdit = (memo: Memo) => {
    setEditingMemoId(memo.id);
    setEditBody(memo.body);
  };

  const saveEdit = async () => {
    if (editingMemoId === null || !editBody.trim()) return;
    setEditBusy(true);
    const r = await apiFetch(`/api/memos/${editingMemoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody }),
    });
    setEditBusy(false);
    if (r.ok) {
      setEditingMemoId(null);
      setEditBody("");
      void load();
    }
  };

  const moveMonth = (offset: number) => {
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(nextMonth);
    setSelected(iso(nextMonth));
  };

  const moveToday = () => {
    const current = new Date();
    setMonth(new Date(current.getFullYear(), current.getMonth(), 1));
    setSelected(iso(current));
  };

  // 달력 격자
  const firstDow = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const activeFarmIds = new Set(farms.map((f) => f.farm_id));
  const visibleMemos = memos.filter((m) => activeFarmIds.has(m.farm_id));
  const memoDays = new Set(visibleMemos.map((m) => m.memo_date));
  const dayMemos = visibleMemos.filter((m) => m.memo_date === selected);
  const filteredMemos = memoFarmFilter === "all"
    ? visibleMemos
    : visibleMemos.filter((m) => m.farm_id === memoFarmFilter);
  const farmName = (id: string) => farms.find((f) => f.farm_id === id)?.name ?? id;
  const selectedDateLabel = `${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8, 10))}일`;

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-22 font-extrabold">농업일지</h1>
        <span className="text-13 font-semibold text-muted">
          날짜를 선택해 메모를 작성하고 기록을 확인해요
        </span>
      </div>

      <section className="mb-5">
        <PlannedBox feature="자동 리포트 (일간·주간·월간·년간)" basis="FR-17 · 통계 엔진">
          통계 데이터를 바탕으로 리포트가 자동 생성되어 메모와 함께 날짜별로 표시됩니다.
        </PlannedBox>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 lg:h-[26rem] lg:grid-cols-2">
        {/* 달력 */}
        <Card className="h-full">
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={() => moveMonth(-1)}
              className="h-8 w-8 rounded-lg bg-surface text-14 font-extrabold text-gray-500"
              aria-label="이전 달"
            >‹</button>
            <span className="text-15 font-extrabold">
              {month.getFullYear()}년 {month.getMonth() + 1}월
            </span>
            <button
              onClick={() => moveMonth(1)}
              className="h-8 w-8 rounded-lg bg-surface text-14 font-extrabold text-gray-500"
              aria-label="다음 달"
            >›</button>
            <button
              onClick={moveToday}
              className="h-8 rounded-lg border border-line bg-white px-3 text-12 font-bold text-gray-600 hover:bg-surface"
            >오늘</button>
            <span className="ml-auto flex items-center gap-1.5 text-11.5 font-semibold text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> 메모 있음
            </span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK.map((w) => (
              <span key={w} className="py-1 text-11.5 font-extrabold text-muted">{w}</span>
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
                  className={`flex h-11 flex-col items-center justify-center rounded-xl text-13.5 font-bold ${
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
        <Card className="flex h-full min-h-0 flex-col">
          <SectionTitle title={`${selected} 일지`} sub={`메모 ${dayMemos.length}건`} />
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {dayMemos.map((m) => (
              <div key={m.id} className="rounded-xl bg-surface p-3.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-md bg-primary-bg px-1.5 py-0.5 text-11 font-extrabold text-primary-dark">
                    {farmName(m.farm_id)}
                  </span>
                  <span className="text-11.5 font-semibold text-muted">{m.author}</span>
                  {(user?.role === "admin" || user?.email === m.author_email) && editingMemoId !== m.id && (
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        className="text-11.5 font-bold text-gray-400"
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingMemoId(m.id)}
                        className="text-11.5 font-bold text-gray-400"
                      >
                        삭제
                      </button>
                    </span>
                  )}
                </div>
                {editingMemoId === m.id ? (
                  <div>
                    <textarea
                      autoFocus
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-13.5 font-semibold text-gray-700 outline-none focus:border-primary"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={editBusy}
                        onClick={() => { setEditingMemoId(null); setEditBody(""); }}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-12 font-bold text-gray-500 disabled:opacity-50"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        disabled={editBusy || !editBody.trim()}
                        onClick={() => void saveEdit()}
                        className="rounded-lg bg-primary px-3 py-1.5 text-12 font-extrabold text-white disabled:bg-gray-200 disabled:text-gray-400"
                      >
                        {editBusy ? "저장 중…" : "저장"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-13.5 font-semibold leading-relaxed text-gray-700">{m.body}</p>
                )}
              </div>
            ))}
            {dayMemos.length === 0 && (
              <div className="py-6 text-center text-13 font-semibold text-muted">
                이 날짜에 등록된 일지가 없어요. 아래에서 메모를 작성해 보세요.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* 메모 작성 */}
      <section className="mb-5">
        <Card className="border border-primary/40 shadow-none">
          <SectionTitle title={`${selectedDateLabel} 메모 작성`} sub="달력에서 날짜를 선택하면 해당 날짜로 작성돼요" />
          {canControl(user) ? (
            <form onSubmit={save}>
              <p className="mb-2 text-13 font-extrabold text-gray-700">대상 농장</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {farms.map((f) => (
                  <button
                    key={f.farm_id} type="button" onClick={() => setFarmId(f.farm_id)}
                    className={`rounded-xl border px-3 py-1.5 text-12.5 ${
                      farmId === f.farm_id
                        ? "border-primary bg-primary-bg font-extrabold text-primary-dark"
                        : "border-gray-200 font-bold text-gray-500"
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <div className="relative">
                <textarea
                  value={body} onChange={(e) => setBody(e.target.value)} rows={4}
                  placeholder="메모를 입력하거나 음성으로 작성하세요…"
                  className="w-full rounded-xl border border-gray-200 px-3.5 pb-14 pt-3 text-13.5 font-semibold outline-none focus:border-primary"
                />
                <button
                  type="button" disabled title="음성 작성은 개발 예정입니다 (FR-28)"
                  className="absolute bottom-3 right-3 rounded-xl bg-gray-100 px-3.5 py-2 text-12.5 font-bold text-gray-400"
                >
                  🎤 음성으로 작성
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <button
                  type="button" disabled title="사진·동영상 첨부는 개발 예정입니다 (FR-18)"
                  className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-gray-400"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <span className="relative bottom-1">
                  <PlannedChip basis="FR-28 음성 · FR-18 첨부" />
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button" onClick={() => setBody("")} disabled={!body}
                    className="rounded-xl bg-gray-100 px-5 py-2 text-13.5 font-extrabold text-gray-600 disabled:text-gray-400"
                  >
                    초기화
                  </button>
                  <button
                    type="submit" disabled={busy || !body.trim()}
                    className="rounded-xl bg-primary px-5 py-2 text-13.5 font-extrabold text-white disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {busy ? "저장 중…" : "저장"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <p className="text-13 font-semibold text-muted">
              조회 전용 계정 — 메모 작성 권한이 없습니다.
            </p>
          )}
        </Card>
      </section>

      {/* 전체 일지 */}
      <section>
        <Card>
          <SectionTitle
            title="전체 일지"
            sub={`${monthKey} · ${filteredMemos.length}건`}
            right={(
              <span className="inline-flex rounded-xl bg-surface p-1">
                <button
                  type="button"
                  onClick={() => setMemoFarmFilter("all")}
                  className={`rounded-lg px-3 py-1.5 text-11.5 font-extrabold ${
                    memoFarmFilter === "all" ? "bg-white text-gray-700 shadow-sm" : "text-muted"
                  }`}
                >
                  전체
                </button>
                {farms.map((f) => (
                  <button
                    key={f.farm_id}
                    type="button"
                    onClick={() => setMemoFarmFilter(f.farm_id)}
                    className={`rounded-lg px-3 py-1.5 text-11.5 font-extrabold ${
                      memoFarmFilter === f.farm_id ? "bg-white text-gray-700 shadow-sm" : "text-muted"
                    }`}
                  >
                    {f.name.split(" ")[0]}
                  </button>
                ))}
              </span>
            )}
          />
          <div className="space-y-2">
            {filteredMemos.map((m) => (
              <button
                key={m.id} onClick={() => setSelected(m.memo_date)}
                className="flex w-full items-center gap-3 rounded-xl bg-surface px-3.5 py-3 text-left hover:bg-gray-100"
              >
                <span className="flex-none rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-12 font-extrabold text-gray-600">
                  {m.memo_date.slice(5)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 rounded-md bg-primary-bg px-1.5 py-0.5 text-11 font-extrabold text-primary-dark">
                    {farmName(m.farm_id)}
                  </span>
                  <span className="text-13.5 font-semibold text-gray-700">{m.body}</span>
                </span>
                <span className="flex-none text-11.5 font-semibold text-muted">{m.author}</span>
              </button>
            ))}
            {filteredMemos.length === 0 && (
              <div className="py-8 text-center text-13 font-semibold text-muted">
                선택한 조건에 해당하는 이번 달 메모가 없어요
              </div>
            )}
          </div>
        </Card>
      </section>

      {deletingMemoId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!deleteBusy) setDeletingMemoId(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-memo-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-memo-title" className="text-16 font-extrabold">삭제 확인</h3>
            <p className="mt-3 text-13.5 font-semibold text-gray-700">
              이 메모를 삭제할까요? 삭제한 메모는 복구할 수 없어요.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => setDeletingMemoId(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-13 font-bold text-gray-500 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => void remove()}
                className="rounded-lg bg-status-warning px-4 py-2 text-13 font-extrabold text-white disabled:opacity-50"
              >
                {deleteBusy ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
