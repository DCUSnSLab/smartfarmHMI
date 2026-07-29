"""내부 재발행기 — component-internals.md §3.

수신·정규화한 데이터를 farmon-internal/v1/{farm}/{stream} 으로 재발행한다.
애플리케이션 서버는 이 토픽만 구독한다 (설계 원칙 #2 — 엣지 원시 토픽 금지).

DB 트랜잭션과 발행을 분리하기 위해 Queue 를 사이에 둔다 — 발행 실패가
적재를 막지 않고, 브로커 재접속 동안 메시지는 큐에 대기한다.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import aiomqtt

from middleware.app.config import settings
from shared.schemas.topics import internal_topic

log = logging.getLogger("mw.republish")


class InternalPublisher:
    def __init__(self, maxsize: int = 10_000):
        self._queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue(maxsize=maxsize)

    def publish(self, farm_id: str, stream: str, data: dict) -> None:
        """핸들러에서 호출 — 논블로킹. 큐가 가득 차면 가장 오래된 것을 버린다."""
        payload = json.dumps(
            {
                "channel": f"{farm_id}/{stream}",
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            default=str,
        )
        item = (internal_topic(farm_id, stream), payload)
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self._queue.get_nowait()
            self._queue.put_nowait(item)
            log.warning("republish queue full — oldest dropped")

    async def run(self) -> None:
        while True:
            try:
                async with aiomqtt.Client(
                    settings.mqtt_host, settings.mqtt_port, keepalive=30,
                    identifier="mw-republish",
                ) as client:
                    log.info("republish: connected")
                    while True:
                        topic, payload = await self._queue.get()
                        # retain=True — 신규 구독자(브리지 재시작)가 최신값 즉시 수신
                        await client.publish(topic, payload, qos=1, retain=True)
            except aiomqtt.MqttError as e:
                log.warning("republish: mqtt disconnected (%s) — 5s 후 재접속", e)
                await asyncio.sleep(5)
