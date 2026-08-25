"""인증 헬퍼 — AIBootcamp 패턴 이식 (SimpleJWT + HttpOnly 쿠키, FR-31).

- 토큰에 email·name·role 클레임을 실어 API·WebSocket 검증을 **무상태**로 처리한다
  (요청마다 DB 조회 없음 — 역할 변경은 다음 로그인/갱신에 반영).
- 쿠키: HttpOnly + SameSite=Lax — JS 접근 차단(XSS 완화) + 크로스사이트 POST 차단
  (CSRF 완화). 역할 체계는 admin/manager/viewer 3단계 잠정 (OPN-07).
"""

from dataclasses import dataclass

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

ACCESS_COOKIE = "sf_access"
REFRESH_COOKIE = "sf_refresh"

# 제어 등 조작 권한 (FR-10 제어 API 가드). viewer 는 조회 전용.
CONTROL_ROLES = ("admin", "manager")


@dataclass(frozen=True)
class AuthUser:
    id: int
    email: str
    name: str
    role: str


def issue_tokens(user) -> tuple[str, str]:
    refresh = RefreshToken.for_user(user)
    for t in (refresh, refresh.access_token):
        t["email"] = user.email
        t["name"] = user.name
        t["role"] = user.role
    return str(refresh.access_token), str(refresh)


def _max_age(claim: str) -> int:
    """쿠키 수명은 토큰 수명에서 파생 — 둘이 어긋나면 조용한 로그아웃이 된다."""
    return int(settings.SIMPLE_JWT[claim].total_seconds())


def set_auth_cookies(response, access: str, refresh: str | None = None) -> None:
    response.set_cookie(
        ACCESS_COOKIE, access, httponly=True, samesite="Lax",
        max_age=_max_age("ACCESS_TOKEN_LIFETIME"),
        secure=False,  # TODO(운영): TLS 도입 시 True (k8s main overlay)
    )
    if refresh:
        # path="/" — 라우트 가드가 액세스 만료 시 리프레시 보유 여부로 통과를 판단한다
        response.set_cookie(
            REFRESH_COOKIE, refresh, httponly=True, samesite="Lax",
            max_age=_max_age("REFRESH_TOKEN_LIFETIME"), secure=False,
        )


def clear_auth_cookies(response) -> None:
    response.delete_cookie(ACCESS_COOKIE)
    response.delete_cookie(REFRESH_COOKIE)
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")  # 이전 경로 정리


def user_from_token(raw: str) -> AuthUser | None:
    try:
        token = AccessToken(raw)
    except TokenError:
        return None
    return AuthUser(
        id=token.get("user_id"), email=token.get("email", ""),
        name=token.get("name", ""), role=token.get("role", "viewer"),
    )


def request_user(request: HttpRequest) -> AuthUser | None:
    raw = request.COOKIES.get(ACCESS_COOKIE)
    return user_from_token(raw) if raw else None


def unauthorized() -> JsonResponse:
    return JsonResponse({"error": "인증이 필요합니다"}, status=401)


def forbidden(action: str = "이 작업") -> JsonResponse:
    return JsonResponse({"error": f"{action} 권한이 없습니다"}, status=403)
