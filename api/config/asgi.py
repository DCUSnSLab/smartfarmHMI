"""ASGI 엔트리포인트 — HTTP(Django) + WebSocket(Channels).

WebSocket 라우팅은 증분 3(조회 슬라이스)에서 추가한다.
"""

import os

from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        # "websocket": ...  # 증분 3: AuthMiddleware + URLRouter
    }
)
