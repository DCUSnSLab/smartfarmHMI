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
from shared.schemas import topics
from shared.schemas.topics import internal_topic

log = logging.getLogger("mw.republish")

# 화면이 「서버 침묵」을 판정하는 기준선. 장치가 한 대도 안 보내는 농장에서도
# 이 맥박은 뛴다 — 조용한 농장과 멈춘 서버를 구분하는 유일한 신호다.
HEALTH_INTERVAL_SEC = 10


class InternalPublisher:
    def __init__(self, maxsize: int = 10_000):
        self._queue: asyncio.Queue[tuple[str, str | bytes, bool]] = asyncio.Queue(maxsize=maxsize)

    def publish(self, farm_id: str, stream: str, data: dict) -> None:
        """내부 스트림 재발행 — 논블로킹. 큐가 가득 차면 가장 오래된 것을 버린다."""
        payload = json.dumps(
            {
                "channel": f"{farm_id}/{stream}",
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            default=str,
        )
        self._enqueue(internal_topic(farm_id, stream), payload, retain=True)

    def publish_raw(self, topic: str, payload: str | bytes, retain: bool = False) -> None:
        """임의 토픽 발행 — 커맨드 변환기용. 명령은 retain 금지 (통신 규격 §3)."""
        self._enqueue(topic, payload, retain)

    def _enqueue(self, topic: str, payload: str | bytes, retain: bool) -> None:
        item = (topic, payload, retain)
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self._queue.get_nowait()
            self._queue.put_nowait(item)
            log.warning("republish queue full — oldest dropped")

    async def run(self) -> None:
        # LWT — 미들웨어가 죽으면 브로커가 대신 알린다. 이것이 없으면 서버가
        # 멈춰도 화면은 마지막 값을 정상처럼 계속 보여준다 (엣지와 같은 규약).
        will = aiomqtt.Will(
            topics.HEALTH_TOPIC,
            json.dumps({"channel": f"{topics.SYSTEM_SCOPE}/health",
                        "data": {"service": "middleware", "state": "down"}}),
            qos=1, retain=True,
        )
        while True:
            try:
                async with aiomqtt.Client(
                    settings.mqtt_host, settings.mqtt_port, keepalive=30,
                    identifier="mw-republish", will=will,
                ) as client:
                    log.info("republish: connected")
                    while True:
                        # 내부 스트림은 retain=True(신규 구독자 즉시 수신),
                        # 명령은 retain=False(재접속 시 과거 명령 재실행 방지)
                        topic, payload, retain = await self._queue.get()
                        await client.publish(topic, payload, qos=1, retain=retain)
            except aiomqtt.MqttError as e:
                log.warning("republish: mqtt disconnected (%s) — 5s 후 재접속", e)
                await asyncio.sleep(5)

    async def heartbeat(self) -> None:
        """서버 생존 맥박 — retained 라 새로 붙은 화면도 즉시 받는다."""
        while True:
            self.publish(
                topics.SYSTEM_SCOPE, "health",
                {"service": "middleware", "state": "up", "interval_sec": HEALTH_INTERVAL_SEC},
            )
            await asyncio.sleep(HEALTH_INTERVAL_SEC)
