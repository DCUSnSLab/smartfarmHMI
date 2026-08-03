"use client";

/** 로그인 사용자 훅 — /api/auth/me. 만료 시 /login 이동. */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface AuthUser {
  email: string;
  name: string;
  role: "admin" | "manager" | "viewer";
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "관리자", manager: "농장 관리자", viewer: "조회자",
};

/** 제어 조작 가능 여부 — viewer 는 조회 전용 (OPN-07 잠정 3역할) */
export const canControl = (u: AuthUser | null) =>
  u != null && (u.role === "admin" || u.role === "manager");

export function useUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    apiFetch("/api/auth/me").then(async (r) => {
      if (r.ok) setUser(await r.json());
      else if (r.status === 401) location.href = "/login";
    });
  }, []);
  return user;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });  // 인증 검사 없음 — 갱신 불필요
  location.href = "/login";
}
