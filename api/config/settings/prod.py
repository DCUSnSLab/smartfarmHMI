"""운영 설정 — k8s 배포에서 사용. Secret 은 환경 변수로 주입한다."""

from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
