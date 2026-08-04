/**
 * 라우트 가드 — AIBootcamp Sub-Plan 0.3 패턴 이식 (FR-31).
 * HttpOnly 쿠키의 JWT 를 jose 로 검증한다 (SimpleJWT HS256, 키 = DJANGO_SECRET_KEY).
 * 미인증 → /login 리다이렉트. 역할별 라우트 분리는 화면이 늘어나는 시점(OPN-07)에 확장.
 */

import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "sf_access";
const PUBLIC_PATHS = ["/login", "/forbidden", "/data"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.DJANGO_SECRET_KEY ?? "");
      await jwtVerify(token, secret, { algorithms: ["HS256"] });
      return NextResponse.next();
    } catch {
      // 만료·위조 — 로그인으로
    }
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // /api·/ws 는 nginx 가 Django 로 라우팅하므로 여기 오지 않는다
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
