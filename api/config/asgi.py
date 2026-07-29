"""ASGI 엔트리포인트 — HTTP(Django) + WebSocket(Channels)."""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

django_asgi_app = get_asgi_application()  # 앱 로딩 먼저 (컨슈머 import 전)

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from django.urls import path  # noqa: E402

from apps.core.consumers import MonitorConsumer  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # TODO(증분 5): AuthMiddlewareStack + Origin 검증 (FR-31)
        "websocket": URLRouter([path("ws/monitor", MonitorConsumer.as_asgi())]),
    }
)
