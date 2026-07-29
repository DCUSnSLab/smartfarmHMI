from django.db import connection
from django.http import JsonResponse


def health(request):
    """헬스체크 — DB 연결까지 확인한다 (app_user → app 스키마)."""
    with connection.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    return JsonResponse({"status": "ok", "service": "api"})
