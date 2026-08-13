"""smartfarmHMI 애플리케이션 서버 — 공통 설정.

AIBootcamp api 의 settings 분리 패턴(base/local/prod)을 따른다.
DB 는 app 스키마 전용 계정(app_user)으로 붙는다 — docs/02-domain/db-schema.md §1.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-secret-key-change-me")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "channels",
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "apps.core",
    "apps.accounts",
    "apps.journal",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

# ── DB — app 스키마 전용 계정 (search_path=app 은 롤 기본값, init 스크립트 참고) ──
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="smartfarm"),
        "USER": env("APP_DB_USER", default="app_user"),
        "PASSWORD": env("APP_DB_PASSWORD", default="app_dev"),
        "HOST": env("POSTGRES_HOST", default="timescaledb"),
        "PORT": env("POSTGRES_PORT", default="5432"),
    }
}

# ── 미들웨어 내부 REST / 내부 MQTT ──
MIDDLEWARE_URL = env("MIDDLEWARE_URL", default="http://middleware:8001")
MQTT_HOST = env("MQTT_HOST", default="mosquitto")
MQTT_PORT = env.int("MQTT_PORT", default=1883)

# ── MinIO — 농업일지 첨부 ──
MINIO_ENDPOINT = env("MINIO_ENDPOINT", default="minio:9000").removeprefix("http://").removeprefix("https://")
MINIO_ACCESS_KEY = env("MINIO_ACCESS_KEY", default="minioadmin")
MINIO_SECRET_KEY = env("MINIO_SECRET_KEY", default="minioadmin")
MINIO_BUCKET_ATTACHMENTS = env("MINIO_BUCKET_ATTACHMENTS", default="smartfarm-attachments")
MINIO_SECURE = env.bool("MINIO_SECURE", default=False)

# ── Channels — Redis 채널 레이어 ──
REDIS_URL = env("REDIS_URL", default="redis://redis:6379/0")
# socket_timeout 은 반드시 명시한다 — 불변식은 `> brpop_timeout(5)` 하나다.
# channels-redis 의 메시지 대기는 `BRPOP <채널 키> 5` 이고(core.py 의 brpop_timeout),
# redis-py 8.x 의 socket_timeout 기본값도 5초다(redis/_defaults.py). 두 값이 같으면
# BRPOP 이 빈 응답을 돌려주기 직전에 읽기 타임아웃이 터지고, 그 예외가 ASGI 앱 밖으로
# 나가 컨슈머가 죽는다 (GEN-1323).
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [
                {
                    "address": REDIS_URL,
                    "socket_timeout": 15,
                    "socket_connect_timeout": 5,   # 접속은 짧게 둬야 장애를 빨리 본다
                }
            ]
        },
    }
}

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# ── SimpleJWT — AIBootcamp 정합 (access 30분 / refresh 14일) ──
# 명시하지 않으면 라이브러리 기본값(access 5분)이 적용된다. 쿠키 max_age 는
# 이 값에서 파생한다 (accounts/auth.py). 운영 수치는 OPN-07 과 함께 확정.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env.int("JWT_ACCESS_MINUTES", default=30)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env.int("JWT_REFRESH_DAYS", default=14)),
}

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"