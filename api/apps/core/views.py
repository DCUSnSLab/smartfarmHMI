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


async def _proxy_write(request, method: str, path: str, *, inject_field: str | None = None):
    """쓰기(POST/PUT/DELETE) 위임 — admin/manager 게이트 (device_control 패턴).

    설정(팜·설비 관리) 계열 공용. inject_field 가 주어지면 요청자 email 을 그 필드로 주입한다
    (registered_by/updated_by 감사 기록).
    """
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("설정 변경")
    try:
        body = json.loads(request.body) if request.body else {}
    except ValueError:
        return JsonResponse({"error": "invalid json"}, status=400)
    if inject_field:
        body[inject_field] = user.email
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.request(method, path, json=body)
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


@csrf_exempt
async def farms(request):
    """GET: 농장 목록 + 접속 요약 (FR-38, 로그인). POST: 농장 생성 (admin/manager)."""
    if request.method == "GET":
        if request_user(request) is None:
            return unauthorized()
        return await _proxy_middleware("/internal/farms")
    if request.method == "POST":
        return await _proxy_write(request, "POST", "/internal/farms")
    return HttpResponseNotAllowed(["GET", "POST"])


@csrf_exempt
async def farm_detail(request, farm_id: str):
    """팜 수정(PUT)/소프트 삭제(DELETE) — admin/manager (FR-07·13)."""
    if request.method == "PUT":
        return await _proxy_write(request, "PUT", f"/internal/farms/{farm_id}")
    if request.method == "DELETE":
        return await _proxy_write(request, "DELETE", f"/internal/farms/{farm_id}")
    return HttpResponseNotAllowed(["PUT", "DELETE"])


@csrf_exempt
async def farm_devices(request, farm_id: str):
    """GET: 장치 목록 (로그인). POST: 장치+상세 추가 (admin/manager)."""
    if request.method == "GET":
        if request_user(request) is None:
            return unauthorized()
        return await _proxy_middleware(f"/internal/farms/{farm_id}/devices")
    if request.method == "POST":
        return await _proxy_write(
            request, "POST", f"/internal/farms/{farm_id}/devices", inject_field="registered_by"
        )
    return HttpResponseNotAllowed(["GET", "POST"])


@csrf_exempt
async def farm_device_detail(request, farm_id: str, device_id: str):
    """장치 수정(PUT)/소프트 삭제(DELETE) — admin/manager."""
    if request.method == "PUT":
        return await _proxy_write(
            request, "PUT", f"/internal/farms/{farm_id}/devices/{device_id}", inject_field="updated_by"
        )
    if request.method == "DELETE":
        return await _proxy_write(request, "DELETE", f"/internal/farms/{farm_id}/devices/{device_id}")
    return HttpResponseNotAllowed(["PUT", "DELETE"])


async def discovery(request):
    """미등록이지만 데이터가 들어오는 팜 목록 (발견). 로그인 필수."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware("/internal/discovery")


@csrf_exempt
async def discovery_register(request, farm_id: str):
    """발견된 팜을 등록 (팜+장치+센서 일괄) — admin/manager."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    return await _proxy_write(request, "POST", f"/internal/discovery/{farm_id}/register")


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


async def farm_stop_state(request, farm_id: str):
    """활성 정지 상태 (FR-35·36 표시)."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware(f"/internal/farms/{farm_id}/stop-state")


async def stop_state_all(request):
    """전체 스코프 활성 정지 — 통합 대시보드 초기 로드 (WS 이벤트는 그 순간만 온다)."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware("/internal/stop-state")


@csrf_exempt
async def stop_engage(request):
    """원격 전체 정지 발동 (FR-35) — admin/manager. Cat.2 운전 정지 (비안전등급)."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("원격 전체 정지")
    try:
        body = json.loads(request.body) if request.body else {}
    except ValueError:
        body = {}
    body["by"] = user.email
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.post("/internal/stop", json=body)
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


@csrf_exempt
async def stop_release(request):
    """원격 전체 정지 해제 (FR-35) — 해제 권한 수준은 OPN-18 (잠정: admin/manager)."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("정지 해제")
    try:
        body = json.loads(request.body) if request.body else {}
    except ValueError:
        body = {}
    body["by"] = user.email
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.post("/internal/stop/release", json=body)
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


async def all_alerts(request):
    """전 농장 알림 (FR-33·38) — 통합 대시보드·전역 알림 화면."""
    if request_user(request) is None:
        return unauthorized()
    qs = request.META.get("QUERY_STRING", "")
    return await _proxy_middleware(f"/internal/alerts?{qs}")


async def environment_history(request, farm_id: str):
    """환경 이력 집계 (FR-14) — 통계 차트·센서 24h 추이."""
    if request_user(request) is None:
        return unauthorized()
    qs = request.META.get("QUERY_STRING", "")
    return await _proxy_middleware(f"/internal/farms/{farm_id}/environment/history?{qs}")


async def environment_summary(request, farm_id: str):
    """기간 요약 KPI (FR-14)."""
    if request_user(request) is None:
        return unauthorized()
    qs = request.META.get("QUERY_STRING", "")
    return await _proxy_middleware(f"/internal/farms/{farm_id}/environment/summary?{qs}")


async def farm_alerts(request, farm_id: str):
    """알림 목록 (FR-33). 쿼리: unacked, severity, limit."""
    if request_user(request) is None:
        return unauthorized()
    qs = request.META.get("QUERY_STRING", "")
    return await _proxy_middleware(f"/internal/farms/{farm_id}/alerts?{qs}")


@csrf_exempt
async def alert_ack(request, alert_id: int):
    """알림 읽음 처리 (FR-33) — 로그인 사용자 누구나."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.post(f"/internal/alerts/{alert_id}/ack", json={"by": user.email})
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


@csrf_exempt
async def alerts_ack_all(request, farm_id: str):
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.post(
            f"/internal/farms/{farm_id}/alerts/ack-all", json={"by": user.email}
        )
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


async def alert_rules(request, farm_id: str):
    """알림 규칙 조회 (FR-34)."""
    if request_user(request) is None:
        return unauthorized()
    return await _proxy_middleware(f"/internal/farms/{farm_id}/alert-rules")


@csrf_exempt
async def alert_rule_update(request, rule_id: int):
    """알림 규칙 수정 (FR-34) — admin/manager 만."""
    if request.method != "PUT":
        return HttpResponseNotAllowed(["PUT"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("규칙 설정")
    try:
        body = json.loads(request.body)
    except ValueError:
        return JsonResponse({"error": "invalid json"}, status=400)
    body["updated_by"] = user.email
    async with httpx.AsyncClient(base_url=settings.MIDDLEWARE_URL, timeout=10) as client:
        resp = await client.put(f"/internal/alert-rules/{rule_id}", json=body)
    return JsonResponse(resp.json(), safe=False, status=resp.status_code)


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
