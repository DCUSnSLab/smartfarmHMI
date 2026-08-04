"use client";

/**
 * API 클라이언트 — 401 시 토큰 갱신 후 1회 재시도 (FR-31).
 *
 * 액세스 토큰이 짧아(30분) 만료가 잦다. 갱신은 /api/auth/refresh 가 담당하고,
 * 여기서는 폴러 여러 개가 동시에 401 을 받아도 갱신 호출이 한 번만 나가도록
 * in-flight 프라미스를 공유한다. 로그인 화면 이동 판단은 호출자 몫 (lib/auth.ts).
 */

let inflight: Promise<boolean> | null = null;

async function post(): Promise<boolean> {
  try {
    return (await fetch("/api/auth/refresh", { method: "POST" })).ok;
  } catch {
    return false;  // 네트워크 오류 — 재연결 시 다시 시도한다
  }
}

/** 액세스 토큰 갱신. 동시 호출자는 같은 결과를 기다린다. */
export function refreshToken(): Promise<boolean> {
  if (!inflight) inflight = post().finally(() => { inflight = null; });
  return inflight;
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;
  return (await refreshToken()) ? fetch(url, init) : res;
}
