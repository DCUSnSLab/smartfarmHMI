"""모니터링 WebSocket 컨슈머 — 브라우저 연결 1개당 인스턴스 1개.

역할 (tech-stack.md 컨슈머 4역할):
① 관문 — 인증·농장 접근 권한 검사 (증분 5에서 활성화, 지금은 개발 모드 통과)
② 구독 관리 — 스코프(전체/특정 농장)에 맞는 그룹만 가입
③ 팬아웃 종단 — 브리지가 group_send 한 메시지를 자기 소켓에 씀
④ 푸시 포맷 — 통신 규격 §4.10 형태 유지
"""

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from apps.accounts.auth import ACCESS_COOKIE, user_from_token


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
        # 관문(①): 쿠키 JWT 검증 — 미인증 소켓은 데이터 수신 불가 (FR-31)
        # WS 핸드셰이크는 브라우저가 same-origin 쿠키를 자동 첨부한다
        raw = _cookie(self.scope, ACCESS_COOKIE)
        self.user = user_from_token(raw) if raw else None
        if self.user is None:
            await self.close(code=4401)  # 미인증
            return
        # 농장별 접근 권한 분리는 OPN-07 확정 시 여기서 검사
        self._group: str | None = None
        await self.accept()

    async def receive_json(self, content, **kwargs):
        """{"action":"subscribe","scope":"all"|"<farm_id>"} — 스코프 전환 (FR-38)."""
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
        if self._group:
            await self.channel_layer.group_discard(self._group, self.channel_name)
