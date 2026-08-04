"""개발 설정 — docker-compose dev 타깃에서 사용."""

from .base import *  # noqa: F401,F403

DEBUG = True
CORS_ALLOW_ALL_ORIGINS = True