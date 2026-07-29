"""임의 데이터 생성기 (2차년도 한정 엣지 대역) — component-internals.md §4.

증분 0(스캐폴딩): 브로커 접속 + LWT(death) 등록 + idle 루프까지.
증분 2 에서 birth 발행·센서값 주기 발행·임무 응답이 추가된다.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import aiomqtt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("edge-sim")

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
FARM_ID = os.environ.get("EDGE_SIM_FARM_ID", "seongju")
DEVICE_ID = os.environ.get("EDGE_SIM_DEVICE_ID", "edge-01")

DEATH_TOPIC = f"farmon/v1/{FARM_ID}/edge/{DEVICE_ID}/death"


def death_payload() -> str:
    return json.dumps(
        {
            "type": "death",
            "version": "0.2",
            "farm_id": FARM_ID,
            "device_id": DEVICE_ID,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )


async def run() -> None:
    # LWT — 브로커가 keep-alive 만료를 감지하면 death 를 대신 발행한다 (FR-37).
    will = aiomqtt.Will(topic=DEATH_TOPIC, payload=death_payload(), qos=1, retain=True)
    while True:
        try:
            async with aiomqtt.Client(
                MQTT_HOST, MQTT_PORT, will=will, keepalive=15
            ) as client:
                log.info("connected to %s:%s (farm=%s)", MQTT_HOST, MQTT_PORT, FARM_ID)
                # 증분 2: birth 발행 + 센서 데이터 생성 루프 + command 구독
                while True:
                    await asyncio.sleep(30)
        except aiomqtt.MqttError as e:
            log.warning("mqtt disconnected (%s) — 5s 후 재접속", e)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run())
