"""임의 데이터 생성기 (2차년도 한정 엣지 대역) — component-internals.md §4.

증분 2: birth 발행 + 센서값·로봇 상태 주기 발행 (QoS1, retain — 통신 규격 §3).
증분 4 에서 command 구독·ack 응답이 추가된다.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

import aiomqtt

from shared.schemas import topics
from sim.devices import GROWBED_ID, ROBOTS, SENSORS, robot_state, sensor_value

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("edge-sim")

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
FARM_ID = os.environ.get("EDGE_SIM_FARM_ID", "seongju")
DEVICE_ID = os.environ.get("EDGE_SIM_DEVICE_ID", "edge-01")
PUBLISH_INTERVAL = int(os.environ.get("EDGE_SIM_PUBLISH_INTERVAL", "5"))

DEATH_TOPIC = topics.topic(FARM_ID, "edge", DEVICE_ID, "death")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dump(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


def death_payload() -> str:
    return _dump({"type": "death", "version": "0.2", "farm_id": FARM_ID,
                  "device_id": DEVICE_ID, "timestamp": _now()})


async def publish_births(client: aiomqtt.Client) -> None:
    """접속 시 장치별 birth — 발행 항목 자기기술 (FR-37, 비기능 §1)."""
    births = [
        # 엣지 컨트롤러는 주기 발행이 없음 — publish_interval_sec 미선언 → LWT 로만 생존 판정
        {"device_id": DEVICE_ID, "device_type": "edge", "metrics": [],
         "publish_interval_sec": None},
        {
            "device_id": GROWBED_ID,
            "device_type": "growbed",
            "metrics": [
                {"sensor_id": s.sensor_id, "sensor_type": s.sensor_type, "unit": s.unit,
                 "initial": s.base}
                for s in SENSORS
            ],
        },
        *({"device_id": r, "device_type": "robot", "metrics": []} for r in ROBOTS),
    ]
    for b in births:
        payload = {"type": "birth", "version": "0.2", "farm_id": FARM_ID,
                   "publish_interval_sec": PUBLISH_INTERVAL, "timestamp": _now(), **b}
        await client.publish(
            topics.topic(FARM_ID, b["device_type"], b["device_id"], "birth"),
            _dump(payload), qos=1, retain=True,
        )
    log.info("birth published (%d devices)", len(births))


async def publish_cycle(client: aiomqtt.Client) -> None:
    t = time.time()
    for s in SENSORS:
        payload = {
            "type": "sensor_reading", "version": "0.2", "farm_id": FARM_ID,
            "device_id": GROWBED_ID, "sensor_id": s.sensor_id, "sensor_type": s.sensor_type,
            "location": s.location, "value": sensor_value(s, t), "unit": s.unit,
            "sensor_state": "ok", "timestamp": _now(),
        }
        await client.publish(
            topics.topic(FARM_ID, "growbed", GROWBED_ID, "telemetry"),
            _dump(payload), qos=1, retain=True,
        )
    for r in ROBOTS:
        payload = {"type": "robot_status", "version": "0.2", "farm_id": FARM_ID,
                   "device_id": r, "timestamp": _now(), **robot_state(r, t)}
        await client.publish(
            topics.topic(FARM_ID, "robot", r, "status"), _dump(payload), qos=1, retain=True,
        )


async def run() -> None:
    will = aiomqtt.Will(topic=DEATH_TOPIC, payload=death_payload(), qos=1, retain=True)
    while True:
        try:
            async with aiomqtt.Client(MQTT_HOST, MQTT_PORT, will=will, keepalive=15) as client:
                log.info("connected to %s:%s (farm=%s, interval=%ss)",
                         MQTT_HOST, MQTT_PORT, FARM_ID, PUBLISH_INTERVAL)
                # 이전 비정상 종료의 retained death 제거 (빈 retained 발행 = 삭제).
                # LWT death 의 timestamp 는 접속 시점 생성이라 birth 와 선후 비교가
                # 불가능하므로, 수신 측 가드 대신 발행 측에서 정리한다.
                await client.publish(DEATH_TOPIC, payload=b"", qos=1, retain=True)
                await publish_births(client)
                while True:
                    await publish_cycle(client)
                    await asyncio.sleep(PUBLISH_INTERVAL)
        except aiomqtt.MqttError as e:
            log.warning("mqtt disconnected (%s) — 5s 후 재접속", e)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run())
