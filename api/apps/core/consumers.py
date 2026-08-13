"""모니터링 WebSocket 컨슈머 — 브라우저 연결 1개당 인스턴스 1개.

역할 (tech-stack.md 컨슈머 4역할):
① 관문 — 인증·농장 접근 권한 검사 (증분 5에서 활성화, 지금은 개발 모드 통과)
② 구독 관리 — 스코프(전체/특정 농장)에 맞는 그룹만 가입
③ 팬아웃 종단 — 브리지가 group_send 한 메시지를 자기 소켓에 씀
④ 푸시 포맷 — 통신 규격 §4.10 형태 유지
"""

import logging

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.accounts.auth import ACCESS_COOKIE, user_from_token

logger = logging.getLogger(__name__)

SYSTEM_GROUP = "system"


def _cookie(scope, name: str) -> str | None:
    for key, value in scope.get("headers", []):
        if key == b"cookie":
            for part in value.decode().split(";"):
                k, _, v = part.strip().partition("=")
                if k == name:
                    return v
    return None


class MonitorConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self._group: str | None = None  # 거부 경로에서도 disconnect 가 참조 — 먼저 초기화
        # 관문(①): 쿠키 JWT 검증 — 미인증 소켓은 데이터 수신 불가 (FR-31)
        # WS 핸드셰이크는 브라우저가 same-origin 쿠키를 자동 첨부한다
        raw = _cookie(self.scope, ACCESS_COOKIE)
        self.user = user_from_token(raw) if raw else None
        if self.user is None:
            await self.close(code=4401)  # 미인증
            return
        # 농장별 접근 권한 분리는 OPN-07 확정 시 여기서 검사
        await self.accept()
        # 서버 생존 신호는 스코프와 무관하다 — 전환해도 유지되도록 따로 가입한다.
        await self.channel_layer.group_add(SYSTEM_GROUP, self.channel_name)

    async def receive_json(self, content, **kwargs):
        """{"action":"subscribe","scope":...} 스코프 전환 (FR-38), {"action":"ping"} 생존 확인."""
        # 화면이 「맥박이 끊겼다」를 감지했을 때, 소켓 자체가 죽은 것인지 서버 쪽
        # 파이프라인이 끊긴 것인지 구분하려고 보낸다. 소켓이 살아 있으면 pong 이 온다.
        if content.get("action") == "ping":
            await self.send_json({"type": "pong"})
            return
        if content.get("action") != "subscribe":
            return
        scope = content.get("scope") or "all"
        new_group = "fleet" if scope == "all" else f"farm_{scope}"
        if self._group == new_group:
            return
        if self._group:
            await self.channel_layer.group_discard(self._group, self.channel_name)
        await self.channel_layer.group_add(new_group, self.channel_name)
        self._group = new_group
        await self.send_json({"type": "subscribed", "scope": scope})

    async def stream_update(self, event):
        """브리지 발 group_send({"type":"stream.update", ...}) 수신 → 소켓으로."""
        await self.send_json({
            "type": "update",
            "stream": event["stream"],
            "farm_id": event["farm_id"],
            **event["payload"],
        })

    async def disconnect(self, code):
        if getattr(self, "_group", None):
            await self.channel_layer.group_discard(self._group, self.channel_name)
        if getattr(self, "user", None) is not None:
            await self.channel_layer.group_discard(SYSTEM_GROUP, self.channel_name)

    async def __call__(self, scope, receive, send):
        """예외로 끝나도 그룹 등록을 정리한다.

        Channels 의 `AsyncConsumer.__call__` 은 `StopConsumer` 만 삼키고 나머지 예외는
        ASGI 앱 밖으로 흘린다. 그 경로에서는 `disconnect()` 가 불리지 않아 그룹 등록이
        group_expiry(24시간) 동안 남는다 (GEN-1323).
        """
        try:
            await super().__call__(scope, receive, send)
        except Exception:
            # 정상 종료는 이미 disconnect() 를 지났으므로 이중 호출이 되지 않는다
            if getattr(self, "channel_name", None):
                try:
                    await self.disconnect(1011)   # 1011 = 내부 오류
                except Exception:
                    # 정리 실패가 원래 예외를 가리면 안 된다. 남은 잔재는 group_expiry 가 걷는다
                    logger.exception("컨슈머 예외 종료 후 그룹 정리 실패")
            raise
