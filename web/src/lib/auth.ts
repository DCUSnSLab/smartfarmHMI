"use client";

/**
 * 로그인 사용자 — /api/auth/me. 만료 시 /login 이동.
 *
 * 조회는 셸에서 한 번만 한다. 훅이 각자 fetch 하면 useUser() 를 쓰는 컴포넌트 수만큼
 * 호출되고(헤더는 항상 떠 있어 페이지마다 최소 2회), 401 일 때 여러 인스턴스가 동시에
 * /login 으로 이동을 걸어 리다이렉트가 경합한다.
 */

import { createContext, createElement, useContext, useEffect, useState } from "react";
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

// undefined = 프로바이더 없음, null = 조회 중 — 둘을 구분해야 미사용을 잡아낼 수 있다
const Ctx = createContext<AuthUser | null | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    void apiFetch("/api/auth/me")
      .then(async (r) => {
        if (r.ok) setUser(await r.json());
        else if (r.status === 401) location.href = "/login";
      })
      // 배포 중 게이트웨이 재시작처럼 잠깐 끊긴 것뿐일 수 있다. 로그인 화면으로
      // 보내면 열어 둔 작업이 사라지므로 여기서는 흡수하고, 이후 요청이 실제로
      // 401 을 받으면 그때 보낸다 (apiFetch 의 공통 처리). 처리하지 않으면
      // 거부가 그대로 새어 개발 오버레이가 뜬다.
      .catch(() => {});
  }, []);
  // JSX 대신 createElement — 이 파일을 .tsx 로 바꾸면 확장자가 달라져 webpack 의
  // 영속 캐시에 옛 모듈이 남고, pull 한 사람이 「UserProvider 안에서만 사용」 오류를
  // 보게 된다 (.next 를 지워야 풀림). 한 줄 때문에 그 함정을 만들 이유가 없다.
  return createElement(Ctx.Provider, { value: user }, children);
}

export function useUser(): AuthUser | null {
  const user = useContext(Ctx);
  if (user === undefined) throw new Error("useUser 는 UserProvider 안에서만 사용");
  return user;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });  // 인증 검사 없음 — 갱신 불필요
  location.href = "/login";
}
