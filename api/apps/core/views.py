import json

import httpx
from django.conf import settings
from django.db import connection
from django.http import HttpResponseNotAllowed, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.auth import CONTROL_ROLES, forbidden, request_user, unauthorized


def health(request):
    """헬스체크 — DB 연결까지 확인한다 (app_user → app 스키마)."""
    with connection.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return JsonResponse({"status": "ok", "service": "api"})


async def _proxy_middleware(path: str):
    """미들웨어 내부 REST 위임 — 앱서버는 mw 데이터에 직접 접근하지 않는다 (원칙 #2)."""
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.get(path)
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


async def farms(request):
    """농장 목록 + 접속 요약 (FR-38 전체 현황). 인증 필수."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware("/internal/farms")


async def farm_snapshot(request, farm_id: str):
    """대시보드 초기 로드 스냅샷 (FR-04·08). 인증 필수."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware(f"/internal/farms/{farm_id}/snapshot")


async def farm_commands(request, farm_id: str):
    """최근 제어 명령 이력 (FR-10 상태 표시 초기 로드). 인증 필수."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware(f"/internal/farms/{farm_id}/commands")


@csrf_exempt  # JWT 쿠키(SameSite=Lax) 인증으로 보호 — 크로스사이트 POST 는 쿠키 미전송
async def device_control(request, farm_id: str, device_id: str):
    """생육기 수동제어 요청 (FR-10) — admin/manager 만. viewer 는 조회 전용."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("제어")
    try:
        body = json.loads(request.body)
    except ValueError:
        return JsonResponse({"error": "invalid json"}, status=400)
    body["issued_by"] = user.email  # 발행자 기록 (command_log.issued_by)
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.post(
            f"/internal/farms/{farm_id}/devices/{device_id}/control", json=body
        )
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)
