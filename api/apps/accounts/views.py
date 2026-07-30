"""인증 엔드포인트 — /api/auth/* (FR-31).

로그인·로그아웃·갱신·내 정보. 토큰은 HttpOnly 쿠키로만 오간다 (본문 노출 없음).
"""

import json

from asgiref.sync import sync_to_async
from django.contrib.auth import authenticate
from django.http import HttpResponseNotAllowed, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.auth import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    issue_tokens,
    request_user,
    set_auth_cookies,
    unauthorized,
)


@csrf_exempt  # 로그인 전 CSRF 토큰이 없음. SameSite=Lax 가 크로스사이트 POST 차단
async def login(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    try:
        body = json.loads(request.body)
        email, password = body["email"], body["password"]
    except (ValueError, KeyError):
        return JsonResponse({"error": "email·password 가 필요합니다"}, status=400)

    user = await sync_to_async(authenticate)(request, email=email, password=password)
    if user is None or not user.is_active:
        return JsonResponse({"error": "이메일 또는 비밀번호가 올바르지 않습니다"}, status=401)

    access, refresh = await sync_to_async(issue_tokens)(user)
    resp = JsonResponse({"user": {"email": user.email, "name": user.name, "role": user.role}})
    set_auth_cookies(resp, access, refresh)
    return resp


@csrf_exempt
async def logout(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    resp = JsonResponse({"ok": True})
    clear_auth_cookies(resp)
    return resp


@csrf_exempt
async def refresh(request):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    raw = request.COOKIES.get(REFRESH_COOKIE)
    if not raw:
        return unauthorized()
    try:
        token = RefreshToken(raw)
        access = token.access_token
        for claim in ("email", "name", "role"):
            access[claim] = token.get(claim, "")
    except TokenError:
        return unauthorized()
    resp = JsonResponse({"ok": True})
    set_auth_cookies(resp, str(access))
    return resp


async def me(request):
    user = request_user(request)
    if user is None:
        return unauthorized()
    return JsonResponse({"email": user.email, "name": user.name, "role": user.role})
