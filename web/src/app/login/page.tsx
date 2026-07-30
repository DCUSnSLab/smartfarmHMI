"use client";

/**
 * 로그인 (FR-31) — design-change-spec §3.1 로그인 화면.
 * 디자인 토큰: 주색 #00A05A, 카드 라운드, 강조 굵게. 실패 상태 명시 표시.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace(params.get("next") ?? "/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "로그인에 실패했습니다");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-extrabold text-primary">팜온 스마트팜 HMI</h1>
        <p className="mb-6 text-[13.5px] font-semibold text-muted">
          웹앱 기반 원격 접근 — 계정으로 로그인하세요
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-[13px] font-bold text-gray-600">이메일</span>
          <input
            type="email" required value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] font-semibold outline-none focus:border-primary"
            placeholder="you@example.com"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-[13px] font-bold text-gray-600">비밀번호</span>
          <input
            type="password" required value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-[15px] font-semibold outline-none focus:border-primary"
          />
        </label>

        {error && (
          <p role="alert" className="mb-4 rounded-xl bg-status-warning/10 px-4 py-3 text-[13px] font-bold text-status-warningDark">
            {error}
          </p>
        )}

        <button
          type="submit" disabled={busy}
          className="w-full rounded-xl bg-primary py-3.5 text-[15px] font-extrabold text-white disabled:opacity-60"
        >
          {busy ? "확인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
