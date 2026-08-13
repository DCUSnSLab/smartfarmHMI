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
# 그룹 등록 수명은 기본값(24시간)을 쓴다.
#
# 짧게 줄이려면 살아 있는 연결이 주기적으로 재가입해야 하는데(줄이기만 하면 오래 열어둔
# 화면이 그룹에서 잘려나간다), 그 대가를 지불할 이유가 없다 — 잔재를 대량으로 만들던
# 원인을 아래에서 막았다.
#
# 한때 원인을 「스코프가 바뀔 때마다 소켓을 다시 맺는 것」으로 적어 두었는데 그것은
# 오진이었다. 정상 종료는 disconnect 를 지나 스스로 정리하므로 소켓이 몇 번 다시 맺히든
# 잔재가 남지 않는다 (실측: 새로고침 2회에 그룹 멤버 1 → 1). 잔재는 **정리가 실행되지
# 못하는 경로**, 즉 컨슈머가 예외로 죽을 때만 생긴다.
#
# 이제 남는 경로는 프로세스 즉사(SIGKILL)뿐이고, 그때 잔재는 죽은 프로세스의 접두를
# 달고 있어 새 프로세스의 우편함과 키가 달라 방해하지 않는다. 24시간 후 사라진다.
#
# `socket_timeout` 은 **반드시 명시한다** — 생략하면 소켓이 5초마다 죽는다.
#
# channels-redis 는 컨슈머의 메시지 대기를 `BRPOP <채널> 5` 로 구현한다 (core.py 의
# brpop_timeout=5). 즉 우편함이 비어 있으면 5초를 블로킹한다. 그런데 redis-py 8.x 가
# `socket_timeout` 기본값을 None(무한 대기)에서 5초로 바꿨다 (redis/_defaults.py 의
# DEFAULT_SOCKET_TIMEOUT). 두 값이 같으면 BRPOP 이 빈 응답을 돌려주기 직전에 읽기
# 타임아웃이 터지고, 그 예외가 ASGI 앱 밖으로 나가면서 컨슈머가 죽는다.
#
# 결과가 고약하다. Channels 는 예외로 끝난 앱에 대해 `disconnect()` 를 부르지 않으므로
#   · 소켓이 닫히고 (브라우저는 재연결 → 또 5초 후 죽음 → 무한 반복)
#   · 그룹 등록만 24시간 남아 살아 있는 연결과 우편함을 공유한다 (브리지의 over capacity)
# 게다가 데이터가 5초 안에 계속 오면 BRPOP 이 먼저 반환해 증상이 숨는다 — 값이 조용히
# 끊긴 상태에서만 드러나므로 원인을 소켓·재연결 쪽에서 찾게 된다 (GEN-1323).
#
# redis 는 channels-redis 의 전이 의존성이라 우리 pyproject 에 핀이 없다. 버전이 올라도
# 깨지지 않도록 값을 우리가 쥔다. 불변식은 `socket_timeout > brpop_timeout(5)` 하나다.
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [
                {
                    "address": REDIS_URL,
                    "socket_timeout": 15,          # > brpop_timeout(5). 여유 3배
                    "socket_connect_timeout": 5,   # 접속은 별개 — 짧게 둬 장애를 빨리 본다
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