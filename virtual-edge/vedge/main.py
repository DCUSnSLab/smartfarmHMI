"""가상 엣지 엔트리포인트 — 컨테이너 1개 = 팜 1개.

접속 절차 (통신 규격 §3 LWT 계약):
1. LWT(death, retain) 등록하며 접속
2. 이전 비정상 종료의 retained death 를 빈 retained 발행으로 정리
3. birth 발행 (edge + growbed, 센서 metrics 자기기술)
4. 센서별 독립 발행 태스크 + command 핸들러 동시 실행
"""

import asyncio
import logging

import aiomqtt

from vedge import config, contract
from vedge.actuators import ActuatorHub
from vedge.robots import RobotSim
from vedge.sensors import SensorSim, birth_metrics
from vedge.state import FarmState

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("vedge")


async def run() -> None:
    cfg = config.load()
    state = FarmState()
    sensors = [SensorSim(s, cfg, state) for s in cfg.sensors]
    robots = [RobotSim(r, cfg, state) for r in cfg.robots]
    hub = ActuatorHub(cfg, state)

    death_topic = contract.topic(cfg.farm_id, "edge", cfg.edge_id, "death")
    will = aiomqtt.Will(
        topic=death_topic,
        payload=contract.dump(contract.death(cfg.farm_id, cfg.edge_id)),
        qos=contract.QOS, retain=True,  # §3 — death 는 LWT 로 등록, retain
    )

    while True:
        try:
            async with aiomqtt.Client(
                cfg.mqtt_host, cfg.mqtt_port, will=will, keepalive=15,
                identifier=f"vedge-{cfg.farm_id}",
            ) as client:
                log.info("connected %s:%s — farm=%s (sensors=%d, actuators=%d, robots=%d)",
                         cfg.mqtt_host, cfg.mqtt_port, cfg.farm_id,
                         len(cfg.sensors), len(cfg.actuators), len(cfg.robots))

                # §3 LWT 계약 — 재접속 직후 retained death 정리
                await client.publish(death_topic, payload=b"", qos=contract.QOS, retain=True)

                # §4.9 birth — 엣지(주기 미선언 → LWT 전용 판정) + 생육기(metrics) + 로봇
                births = [
                    ("edge", cfg.edge_id,
                     contract.birth(cfg.farm_id, cfg.edge_id, "edge",
                                    metrics=[], publish_interval_sec=None)),
                    ("growbed", cfg.growbed_id,
                     contract.birth(cfg.farm_id, cfg.growbed_id, "growbed",
                                    metrics=birth_metrics(cfg),
                                    publish_interval_sec=cfg.min_interval_sec)),
                    *[("robot", r.id,
                       contract.birth(cfg.farm_id, r.id, "robot", metrics=[],
                                      publish_interval_sec=int(r.interval_sec)))
                      for r in cfg.robots],
                ]
                for dtype, dev, payload in births:
                    await client.publish(
                        contract.topic(cfg.farm_id, dtype, dev, "birth"),
                        contract.dump(payload), qos=contract.QOS, retain=True,
                    )
                log.info("birth published (edge + growbed + robots=%d, metrics=%d)",
                         len(cfg.robots), len(cfg.sensors))

                await client.subscribe(
                    f"{contract.PREFIX}/{cfg.farm_id}/+/+/command", qos=contract.QOS
                )

                async with asyncio.TaskGroup() as tg:
                    for sensor in sensors:
                        tg.create_task(sensor.run(client))
                    for robot in robots:
                        tg.create_task(robot.run(client))
                    tg.create_task(hub.handle_commands(client))
        except* aiomqtt.MqttError as e:
            log.warning("mqtt disconnected (%s) — 5s 후 재접속", e.exceptions[0])
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run())
