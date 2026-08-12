"""농업일지 첨부 파일의 MinIO 저장·삭제."""

from functools import lru_cache
from typing import BinaryIO

from django.conf import settings
from minio import Minio


@lru_cache(maxsize=1)
def _client() -> Minio:
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )


def put_attachment(storage_key: str, source: BinaryIO, size: int, content_type: str) -> None:
    _client().put_object(
        settings.MINIO_BUCKET_ATTACHMENTS,
        storage_key,
        source,
        length=size,
        content_type=content_type,
    )


def get_attachment(storage_key: str, *, offset: int = 0, length: int | None = None):
    options = {"offset": offset}
    if length is not None:
        options["length"] = length
    return _client().get_object(
        settings.MINIO_BUCKET_ATTACHMENTS,
        storage_key,
        **options,
    )


def remove_attachments(storage_keys: list[str]) -> None:
    if not storage_keys:
        return
    client = _client()
    for storage_key in storage_keys:
        client.remove_object(settings.MINIO_BUCKET_ATTACHMENTS, storage_key)
