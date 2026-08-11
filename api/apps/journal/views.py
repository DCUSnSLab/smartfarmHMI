"""농업일지 — 관리자 메모 API (FR-18).

사진 첨부는 MinIO에 저장하며, 동영상·음성 작성(FR-28)은 개발 예정이다.
자동 리포트(FR-17)는 미들웨어의 통계·리포트 엔진 몫이라 여기 없다.
"""

import json
import logging
from datetime import date
from uuid import uuid4

from asgiref.sync import sync_to_async
from django.db import transaction
from django.http import HttpResponseNotAllowed, JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt

from apps.accounts.auth import CONTROL_ROLES, forbidden, request_user, unauthorized
from apps.journal.models import Attachment, FarmMemo
from apps.journal.storage import get_attachment, put_attachment, remove_attachments

logger = logging.getLogger(__name__)

MAX_IMAGE_COUNT = 10
MAX_IMAGE_SIZE = 10 * 1024 * 1024
IMAGE_SIGNATURES = {
    "image/jpeg": (b"\xff\xd8\xff", ".jpg"),
    "image/png": (b"\x89PNG\r\n\x1a\n", ".png"),
    "image/webp": (b"RIFF", ".webp"),
}
IMAGE_CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _serialize(memo: FarmMemo) -> dict:
    attachments = list(memo.attachments.all())
    return {
        "id": memo.id,
        "farm_id": memo.farm_id,
        "memo_date": memo.memo_date.isoformat(),
        "body": memo.body,
        "via_voice": memo.via_voice,
        "author": memo.author.name,
        "author_email": memo.author.email,
        "attachment_count": len(attachments),
        "attachments": [
            {
                "id": attachment.id,
                "media_type": attachment.media_type,
                "url": f"/api/memos/attachments/{attachment.id}",
            }
            for attachment in attachments
        ],
        "created_at": memo.created_at.isoformat(),
    }


@sync_to_async
def _list_memos(farm_id: str | None, month: str | None) -> list[dict]:
    qs = FarmMemo.objects.select_related("author").prefetch_related("attachments").order_by(
        "-memo_date", "-created_at"
    )
    if farm_id:
        qs = qs.filter(farm_id=farm_id)
    if month:  # YYYY-MM — 달력 표시용
        y, m = month.split("-")
        qs = qs.filter(memo_date__year=int(y), memo_date__month=int(m))
    return [_serialize(x) for x in qs[:200]]


def _image_info(upload) -> tuple[str, str] | None:
    header = upload.read(12)
    upload.seek(0)
    for content_type, (signature, suffix) in IMAGE_SIGNATURES.items():
        if not header.startswith(signature):
            continue
        if content_type == "image/webp" and header[8:12] != b"WEBP":
            continue
        return content_type, suffix
    return None


def _memo_for_response(memo_id: int) -> FarmMemo:
    return (
        FarmMemo.objects.select_related("author")
        .prefetch_related("attachments")
        .get(pk=memo_id)
    )


@sync_to_async
def _create_memo(user_id: int, farm_id: str, memo_date: date, body: str) -> dict:
    memo = FarmMemo.objects.create(
        author_id=user_id, farm_id=farm_id, memo_date=memo_date, body=body,
    )
    memo = _memo_for_response(memo.pk)
    return _serialize(memo)


@sync_to_async
def _delete_memo(memo_id: int, user_id: int, is_admin: bool) -> bool:
    qs = FarmMemo.objects.prefetch_related("attachments").filter(pk=memo_id)
    if not is_admin:
        qs = qs.filter(author_id=user_id)  # 작성자 본인만 (admin 은 전체)
    memo = qs.first()
    if memo is None:
        return False
    remove_attachments([attachment.storage_key for attachment in memo.attachments.all()])
    memo.delete()
    return True


@sync_to_async
def _update_memo(memo_id: int, user_id: int, is_admin: bool, body: str) -> dict | None:
    qs = FarmMemo.objects.select_related("author").prefetch_related("attachments").filter(
        pk=memo_id
    )
    if not is_admin:
        qs = qs.filter(author_id=user_id)
    memo = qs.first()
    if memo is None:
        return None
    memo.body = body
    memo.save(update_fields=["body", "updated_at"])
    return _serialize(memo)


@csrf_exempt
def memo_with_attachments(request):
    """메모와 사진 첨부를 한 요청으로 저장한다."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("메모 작성")

    try:
        farm_id = request.POST["farm_id"]
        memo_date = date.fromisoformat(request.POST["memo_date"])
        text = (request.POST.get("body") or "").strip()
    except (ValueError, KeyError):
        return JsonResponse({"error": "farm_id·memo_date·body 가 필요합니다"}, status=400)
    if not text:
        return JsonResponse({"error": "내용을 입력하세요"}, status=400)

    uploads = request.FILES.getlist("files")
    if not uploads:
        return JsonResponse({"error": "사진을 선택하세요"}, status=400)
    if len(uploads) > MAX_IMAGE_COUNT:
        return JsonResponse({"error": f"사진은 최대 {MAX_IMAGE_COUNT}장까지 저장할 수 있습니다"}, status=400)

    validated = []
    for upload in uploads:
        if upload.size > MAX_IMAGE_SIZE:
            return JsonResponse({"error": "사진은 한 장당 10MB 이하여야 합니다"}, status=400)
        image_info = _image_info(upload)
        if image_info is None:
            return JsonResponse({"error": "JPEG, PNG, WebP 사진만 저장할 수 있습니다"}, status=400)
        validated.append((upload, *image_info))

    stored_keys: list[str] = []
    try:
        with transaction.atomic():
            memo = FarmMemo.objects.create(
                author_id=user.id,
                farm_id=farm_id,
                memo_date=memo_date,
                body=text,
            )
            for upload, content_type, suffix in validated:
                storage_key = f"memos/{memo.id}/{uuid4().hex}{suffix}"
                put_attachment(storage_key, upload, upload.size, content_type)
                stored_keys.append(storage_key)
                Attachment.objects.create(
                    memo=memo,
                    storage_key=storage_key,
                    media_type=Attachment.MediaType.IMAGE,
                    size_bytes=upload.size,
                )
        return JsonResponse(_serialize(_memo_for_response(memo.id)), status=201)
    except Exception:
        logger.exception("메모 사진 첨부 저장 실패")
        try:
            remove_attachments(stored_keys)
        except Exception:
            logger.exception("실패한 메모 첨부 정리 실패")
        return JsonResponse({"error": "사진 저장에 실패했습니다"}, status=500)


@csrf_exempt
def memo_update_with_attachments(request, memo_id: int):
    """기존 메모 내용 수정과 사진 추가·삭제를 한 요청으로 처리한다."""
    if request.method != "POST":
        return HttpResponseNotAllowed(["POST"])
    user = request_user(request)
    if user is None:
        return unauthorized()
    if user.role not in CONTROL_ROLES:
        return forbidden("메모 수정")

    text = (request.POST.get("body") or "").strip()
    if not text:
        return JsonResponse({"error": "내용을 입력하세요"}, status=400)
    uploads = request.FILES.getlist("files")
    try:
        remove_ids = json.loads(request.POST.get("remove_attachment_ids") or "[]")
        if not isinstance(remove_ids, list) or any(type(item) is not int for item in remove_ids):
            raise ValueError
        remove_ids = list(dict.fromkeys(remove_ids))
    except (TypeError, ValueError):
        return JsonResponse({"error": "삭제할 첨부 정보가 올바르지 않습니다"}, status=400)
    if not uploads and not remove_ids:
        return JsonResponse({"error": "추가하거나 삭제할 사진을 선택하세요"}, status=400)

    validated = []
    for upload in uploads:
        if upload.size > MAX_IMAGE_SIZE:
            return JsonResponse({"error": "사진은 한 장당 10MB 이하여야 합니다"}, status=400)
        image_info = _image_info(upload)
        if image_info is None:
            return JsonResponse({"error": "JPEG, PNG, WebP 사진만 저장할 수 있습니다"}, status=400)
        validated.append((upload, *image_info))

    stored_keys: list[str] = []
    removed_keys: list[str] = []
    try:
        with transaction.atomic():
            qs = FarmMemo.objects.select_for_update().filter(pk=memo_id)
            if user.role != "admin":
                qs = qs.filter(author_id=user.id)
            memo = qs.first()
            if memo is None:
                return JsonResponse({"error": "메모를 찾을 수 없거나 권한이 없습니다"}, status=404)

            attachments_to_remove = list(memo.attachments.filter(pk__in=remove_ids))
            if len(attachments_to_remove) != len(remove_ids):
                return JsonResponse({"error": "삭제할 사진을 찾을 수 없습니다"}, status=400)
            remaining_count = memo.attachments.count() - len(attachments_to_remove)
            if remaining_count + len(validated) > MAX_IMAGE_COUNT:
                return JsonResponse(
                    {"error": f"사진은 기존 첨부를 포함해 최대 {MAX_IMAGE_COUNT}장까지 저장할 수 있습니다"},
                    status=400,
                )

            memo.body = text
            memo.save(update_fields=["body", "updated_at"])
            for upload, content_type, suffix in validated:
                storage_key = f"memos/{memo.id}/{uuid4().hex}{suffix}"
                put_attachment(storage_key, upload, upload.size, content_type)
                stored_keys.append(storage_key)
                Attachment.objects.create(
                    memo=memo,
                    storage_key=storage_key,
                    media_type=Attachment.MediaType.IMAGE,
                    size_bytes=upload.size,
                )

            removed_keys = [attachment.storage_key for attachment in attachments_to_remove]
            if remove_ids:
                Attachment.objects.filter(pk__in=remove_ids).delete()
    except Exception:
        logger.exception("메모 수정 사진 첨부 저장 실패: memo_id=%s", memo_id)
        try:
            remove_attachments(stored_keys)
        except Exception:
            logger.exception("실패한 수정 첨부 정리 실패: memo_id=%s", memo_id)
        return JsonResponse({"error": "메모 수정과 사진 저장에 실패했습니다"}, status=500)

    try:
        remove_attachments(removed_keys)
    except Exception:
        logger.exception("삭제한 메모 첨부 원본 정리 실패: memo_id=%s", memo_id)
    return JsonResponse(_serialize(_memo_for_response(memo.id)))


def _attachment_chunks(response):
    try:
        while chunk := response.read(64 * 1024):
            yield chunk
    finally:
        response.close()
        response.release_conn()


@csrf_exempt
def memo_attachment(request, attachment_id: int):
    """인증된 사용자에게 메모 첨부 원본을 스트리밍한다."""
    if request.method != "GET":
        return HttpResponseNotAllowed(["GET"])
    if request_user(request) is None:
        return unauthorized()

    attachment = Attachment.objects.filter(pk=attachment_id).first()
    if attachment is None:
        return JsonResponse({"error": "첨부를 찾을 수 없습니다"}, status=404)
    try:
        source = get_attachment(attachment.storage_key)
    except Exception:
        logger.exception("메모 첨부 조회 실패: attachment_id=%s", attachment_id)
        return JsonResponse({"error": "첨부를 불러오지 못했습니다"}, status=502)

    suffix = "." + attachment.storage_key.rsplit(".", 1)[-1].lower()
    response = StreamingHttpResponse(
        _attachment_chunks(source),
        content_type=IMAGE_CONTENT_TYPES.get(suffix, "application/octet-stream"),
    )
    response["Content-Length"] = attachment.size_bytes
    response["Content-Disposition"] = "inline"
    response["Cache-Control"] = "private, max-age=300"
    response["X-Content-Type-Options"] = "nosniff"
    return response


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
