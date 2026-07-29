"""모니터링 WebSocket 컨슈머 — 브라우저 연결 1개당 인스턴스 1개.

역할 (tech-stack.md 컨슈머 4역할):
① 관문 — 인증·농장 접근 권한 검사 (증분 5에서 활성화, 지금은 개발 모드 통과)
② 구독 관리 — 스코프(전체/특정 농장)에 맞는 그룹만 가입
③ 팬아웃 종단 — 브리지가 group_send 한 메시지를 자기 소켓에 씀
④ 푸시 포맷 — 통신 규격 §4.10 형태 유지
"""

from channels.generic.websocket import AsyncJsonWebsocketConsumer


class MonitorConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        # TODO(증분 5): HttpOnly 쿠키 JWT 검증 + 농장 접근 권한 검사 (FR-31)
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
