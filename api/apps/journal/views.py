"""농업일지 — 관리자 메모 API (FR-18).

첨부(사진·동영상)와 음성 작성(FR-28)은 개발 예정 — 화면에 Planned 로 표시된다.
자동 리포트(FR-17)는 미들웨어의 통계·리포트 엔진 몫이라 여기 없다.
"""

import json
from datetime import date

from asgiref.sync import sync_to_async
from django.http import HttpResponseNotAllowed, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.auth import CONTROL_ROLES, forbidden, request_user, unauthorized
from apps.journal.models import FarmMemo


def _serialize(memo: FarmMemo) -> dict:
    return {
        "id": memo.id,
        "farm_id": memo.farm_id,
        "memo_date": memo.memo_date.isoformat(),
        "body": memo.body,
        "via_voice": memo.via_voice,
        "author": memo.author.name,
        "author_email": memo.author.email,
        "created_at": memo.created_at.isoformat(),
    }


@sync_to_async
def _list_memos(farm_id: str | None, month: str | None) -> list[dict]:
    qs = FarmMemo.objects.select_related("author").order_by("-memo_date", "-created_at")
    if farm_id:
        qs = qs.filter(farm_id=farm_id)
    if month:  # YYYY-MM — 달력 표시용
        y, m = month.split("-")
        qs = qs.filter(memo_date__year=int(y), memo_date__month=int(m))
    return [_serialize(x) for x in qs[:200]]


@sync_to_async
def _create_memo(user_id: int, farm_id: str, memo_date: date, body: str) -> dict:
    memo = FarmMemo.objects.create(
        author_id=user_id, farm_id=farm_id, memo_date=memo_date, body=body,
    )
    memo = FarmMemo.objects.select_related("author").get(pk=memo.pk)
    return _serialize(memo)


@sync_to_async
def _delete_memo(memo_id: int, user_id: int, is_admin: bool) -> bool:
    qs = FarmMemo.objects.filter(pk=memo_id)
    if not is_admin:
        qs = qs.filter(author_id=user_id)  # 작성자 본인만 (admin 은 전체)
    return qs.delete()[0] > 0


@sync_to_async
def _update_memo(memo_id: int, user_id: int, is_admin: bool, body: str) -> dict | None:
    qs = FarmMemo.objects.select_related("author").filter(pk=memo_id)
    if not is_admin:
        qs = qs.filter(author_id=user_id)
    memo = qs.first()
    if memo is None:
        return None
    memo.body = body
    memo.save(update_fields=["body", "updated_at"])
    return _serialize(memo)


@csrf_exempt
async def memos(request):
    """GET 목록(farm_id·month 필터) / POST 작성 (admin·manager)."""
    user = request_user(request)
    if user is None:
        return unauthorized()

    if request.method == "GET":
        farm_id = request.GET.get("farm_id") or None
        month = request.GET.get("month") or None
        return JsonResponse(await _list_memos(farm_id, month), safe=False)

    if request.method == "POST":
        if user.role not in CONTROL_ROLES:
            return forbidden("메모 작성")
        try:
            body = json.loads(request.body)
            farm_id = body["farm_id"]
            memo_date = date.fromisoformat(body["memo_date"])
            text = (body.get("body") or "").strip()
        except (ValueError, KeyError):
            return JsonResponse({"error": "farm_id·memo_date·body 가 필요합니다"}, status=400)
        if not text:
            return JsonResponse({"error": "내용을 입력하세요"}, status=400)
        return JsonResponse(await _create_memo(user.id, farm_id, memo_date, text), status=201)

    return HttpResponseNotAllowed(["GET", "POST"])


@csrf_exempt
async def memo_detail(request, memo_id: int):
    """PATCH 수정 / DELETE 삭제 — 작성자 본인 또는 admin."""
    user = request_user(request)
    if user is None:
        return unauthorized()

    if request.method == "PATCH":
        if user.role not in CONTROL_ROLES:
            return forbidden("메모 수정")
        try:
            payload = json.loads(request.body)
            text = (payload.get("body") or "").strip()
        except ValueError:
            return JsonResponse({"error": "올바른 JSON 본문이 필요합니다"}, status=400)
        if not text:
            return JsonResponse({"error": "내용을 입력하세요"}, status=400)
        memo = await _update_memo(memo_id, user.id, user.role == "admin", text)
        if memo is None:
            return JsonResponse({"error": "메모를 찾을 수 없거나 권한이 없습니다"}, status=404)
        return JsonResponse(memo)

    if request.method != "DELETE":
        return HttpResponseNotAllowed(["PATCH", "DELETE"])
    ok = await _delete_memo(memo_id, user.id, user.role == "admin")
    if not ok:
        return JsonResponse({"error": "메모를 찾을 수 없거나 권한이 없습니다"}, status=404)
    return JsonResponse({"ok": True})
