"""내부 MQTT 구독 브리지 — **반드시 단일 인스턴스로 실행** (tech-stack.md).

farmon-internal/v1/{farm}/{stream} 을 구독해 Redis 채널 레이어 그룹으로 중계한다.
ASGI 워커마다 실행하면 같은 메시지가 워커 수만큼 중복 push 되므로,
compose 의 api-bridge 서비스(1개)로만 띄운다.

그룹: farm_{farm_id} (특정 농장 화면) + fleet (전체 현황 화면).
엣지 원시 토픽(farmon/v1/#)은 구독하지 않는다 — 설계 원칙 #2.
"""

import asyncio
import json
import logging

import aiomqtt
from channels.layers import get_channel_layer
from django.conf import settings as dj_settings
from django.core.management.base import BaseCommand

log = logging.getLogger("api.bridge")

INTERNAL_PREFIX = "farmon-internal/v1"
SYSTEM_SCOPE = "_system"   # farm_id 자리에 오지만 농장이 아니다 (topics.SYSTEM_SCOPE)
SYSTEM_GROUP = "system"    # 스코프와 무관하게 모든 소켓이 가입


async def bridge_loop() -> None:
    channel_layer = get_channel_layer()
    host = dj_settings.MQTT_HOST
    port = dj_settings.MQTT_PORT
    while True:
        try:
            async with aiomqtt.Client(host, port, keepalive=30, identifier="api-bridge") as client:
                await client.subscribe(f"{INTERNAL_PREFIX}/#", qos=1)
                log.info("bridge: subscribed %s/# @ %s", INTERNAL_PREFIX, host)
                async for message in client.messages:
                    parts = str(message.topic).split("/")
                    if len(parts) != 4:
                        continue
                    farm_id, stream = parts[2], parts[3]
                    try:
                        body = json.loads(message.payload)
                    except (TypeError, ValueError):
                        continue
                    event = {"type": "stream.update", "stream": stream,
                             "farm_id": farm_id, "payload": body}
                    if farm_id == SYSTEM_SCOPE:
                        # 서버 생존은 어느 화면을 보고 있든 와야 한다 — 농장 그룹에
                        # 넣으면 그 농장 화면만 받는다.
                        await channel_layer.group_send(SYSTEM_GROUP, event)
                        continue
                    await channel_layer.group_send(f"farm_{farm_id}", event)
                    await channel_layer.group_send("fleet", event)
        except aiomqtt.MqttError as e:
            log.warning("bridge: mqtt disconnected (%s) — 5s 후 재접속", e)
            await asyncio.sleep(5)


class Command(BaseCommand):
    help = "내부 MQTT → Channels 브리지 (단일 인스턴스 전용)"

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        asyncio.run(bridge_loop())
