import httpx
from django.conf import settings
from django.db import connection
from django.http import JsonResponse


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
    """농장 목록 + 접속 요약 (FR-38 전체 현황)."""
    return await _proxy_middleware("/internal/farms")


async def farm_snapshot(request, farm_id: str):
    """대시보드 초기 로드 스냅샷 (FR-04·08)."""
    return await _proxy_middleware(f"/internal/farms/{farm_id}/snapshot")
