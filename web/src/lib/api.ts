"use client";

/**
 * API 클라이언트 — 401 시 토큰 갱신 후 1회 재시도 (FR-31).
 *
 * 액세스 토큰이 짧아(30분) 만료가 잦다. 갱신은 /api/auth/refresh 가 담당하고,
 * 여기서는 폴러 여러 개가 동시에 401 을 받아도 갱신 호출이 한 번만 나가도록
 * in-flight 프라미스를 공유한다.
 *
 * 갱신까지 거부되면 여기서 로그인 화면으로 보낸다. 화면 진입 시 검사(lib/auth.ts 의
 * UserProvider)는 마운트 때 한 번뿐이라, 탭을 열어 둔 채 세션이 만료되면 아무도
 * 알아채지 못한다. 그러면 폴러와 소켓이 401 을 받고 조용히 재시도만 반복하고,
 * 사용자에게는 「서버에서 신호가 오지 않습니다」 배너만 보인다.
 */

let inflight: Promise<boolean> | null = null;
/** 이동을 한 번만 건다 — 폴러가 여럿이라 같은 순간에 401 이 몰린다 */
let leaving = false;

function sessionExpired(): void {
  if (leaving) return;
  leaving = true;
  // middleware.ts 와 같은 규칙 — 루트가 아니면 돌아올 경로를 남긴다
  const url = new URL("/login", location.origin);
  if (location.pathname !== "/") {
    url.searchParams.set("next", location.pathname + location.search);
  }
  location.href = url.toString();
}

async function post(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    if (res.ok) return true;
    // 401·403 은 리프레시 토큰이 죽은 것 (accounts/views.py 의 unauthorized).
    // 재시도로 풀리지 않으므로 내보낸다. 502 같은 일시 장애는 제외한다 —
    // 배포 중 게이트웨이가 흔들릴 때마다 로그아웃되면 안 된다.
    if (res.status === 401 || res.status === 403) sessionExpired();
    return false;
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
