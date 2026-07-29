"""관리자 메모·첨부·음성 기록 — db-schema.md §4 (app 스키마, 사용자 직접 입력).

farm_id 는 mw.farm 의 참조값이지만 스키마 경계상 FK 를 걸지 않는다 —
검증은 API 레벨(미들웨어 내부 REST 조회)에서 수행한다.
"""

from django.conf import settings
from django.db import models


class FarmMemo(models.Model):
    """관리자 메모 (FR-18·28). 자동 리포트는 mw.farm_report — FarmLog 분리."""

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    farm_id = models.TextField()
    memo_date = models.DateField()  # 달력 상 대상 일자
    body = models.TextField()
    via_voice = models.BooleanField(default=False)  # 음성 작성 여부 (FR-28)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "farm_memo"
        indexes = [models.Index(fields=["farm_id", "memo_date"])]


class Attachment(models.Model):
    """메모 첨부 (FR-18) — 원본은 MinIO, 여기는 객체 키만."""

    class MediaType(models.TextChoices):
        IMAGE = "image", "사진"
        VIDEO = "video", "동영상"

    memo = models.ForeignKey(FarmMemo, on_delete=models.CASCADE, related_name="attachments")
    storage_key = models.TextField()
    media_type = models.CharField(max_length=10, choices=MediaType.choices)
    size_bytes = models.BigIntegerField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "attachment"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(media_type__in=["image", "video"]),
                name="attachment_media_type_check",
            )
        ]


class VoiceLog(models.Model):
    """음성 명령·메모 기록 (FR-29)."""

    class LogKind(models.TextChoices):
        COMMAND = "command", "음성 명령"
        MEMO = "memo", "음성 메모"

    class Result(models.TextChoices):
        EXECUTED = "executed", "실행됨"
        REJECTED = "rejected", "거부됨"
        FALLBACK = "fallback", "텍스트 폴백"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    log_kind = models.CharField(max_length=10, choices=LogKind.choices)
    spoken_text = models.TextField(null=True, blank=True)  # STT 결과 또는 텍스트 폴백 원문
    recognized_intent = models.TextField(null=True, blank=True)
    result = models.CharField(max_length=10, choices=Result.choices, null=True, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "voice_log"
        indexes = [models.Index(fields=["user", "occurred_at"])]
