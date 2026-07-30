"""임의 데이터 생성기 (2차년도 한정 엣지 대역) — component-internals.md §4.

- birth 발행 + 센서값·로봇 상태 주기 발행 (QoS1, retain — 통신 규격 §3)
- command 구독 → command_id 멱등 처리 → ack(accepted→completed) 응답 (비기능 §4)
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone

import aiomqtt

from shared.schemas import topics
from sim.devices import (
    GROWBED_ID, ROBOTS, SENSORS, STOPPED, apply_command, robot_state, sensor_value,
)

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


# 처리한 command_id — QoS1 중복 배달 시 재실행 방지 (멱등, 비기능 §4)
_seen_commands: set[str] = set()


async def _ack(client: aiomqtt.Client, device_type: str, device_id: str,
               command_id: str, result: str, detail: dict | None = None) -> None:
    payload = {"type": "ack", "version": "0.2", "farm_id": FARM_ID, "command_id": command_id,
               "device_id": device_id, "result": result, "detail": detail, "timestamp": _now()}
    await client.publish(
        topics.topic(FARM_ID, device_type, device_id, "ack"), _dump(payload), qos=1,
    )


async def handle_commands(client: aiomqtt.Client) -> None:
    """command 토픽 구독 — 접수(accepted) → 적용 → 완료(completed) 2단 응답."""
    async for message in client.messages:
        parsed = topics.parse_topic(str(message.topic))
        if parsed is None or parsed.message_type != "command" or not message.payload:
            continue
        try:
            body = json.loads(message.payload)
        except ValueError:
            continue
        command_id = body.get("command_id")
        if not command_id:
            continue
        if command_id in _seen_commands:
            # 중복 배달 — 재실행 없이 completed 만 재응답 (ack 유실 대비)
            log.info("duplicate command ignored: %s", command_id)
            await _ack(client, parsed.device_type, parsed.device_id, command_id, "completed")
            continue
        _seen_commands.add(command_id)

        # 원격 전체 정지 / 해제 (FR-35) — 진행 작업 정지·재개 모사
        if body.get("type") in ("remote_stop", "remote_stop_release"):
            STOPPED["value"] = body["type"] == "remote_stop"
            log.warning("remote stop %s (farm=%s)",
                        "engaged" if STOPPED["value"] else "released", FARM_ID)
            await _ack(client, parsed.device_type, parsed.device_id, command_id, "completed")
            continue

        if body.get("type") != "control_command":
            await _ack(client, parsed.device_type, parsed.device_id, command_id,
                       "rejected", {"reason": f"unsupported type: {body.get('type')}"})
            continue

        await _ack(client, parsed.device_type, parsed.device_id, command_id, "accepted")
        ok = apply_command(body.get("command", ""), body.get("params", {}))
        await asyncio.sleep(1)  # 실행 시간 모사
        if ok:
            log.info("command applied: %s %s %s", command_id, body["command"], body["params"])
            await _ack(client, parsed.device_type, parsed.device_id, command_id, "completed")
        else:
            await _ack(client, parsed.device_type, parsed.device_id, command_id,
                       "failed", {"reason": f"unknown command: {body.get('command')}"})


async def publish_loop(client: aiomqtt.Client) -> None:
    while True:
        await publish_cycle(client)
        await asyncio.sleep(PUBLISH_INTERVAL)


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
                await client.subscribe(f"{topics.PREFIX}/{FARM_ID}/+/+/command", qos=1)
                await publish_births(client)
                async with asyncio.TaskGroup() as tg:
                    tg.create_task(publish_loop(client))
                    tg.create_task(handle_commands(client))
        except* aiomqtt.MqttError as e:
            log.warning("mqtt disconnected (%s) — 5s 후 재접속", e.exceptions[0])
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run())
