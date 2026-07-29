"""데이터 수집기 — 엣지 토픽 구독 → 검증 → 적재 (component-internals.md §3).

- QoS1 중복 배달 대비: 하이퍼테이블 복합 PK + ON CONFLICT DO NOTHING (멱등)
- 최신값 캐시: sensor.last_value / last_ts 를 적재와 함께 갱신 (대시보드용)
- 통신 상태: birth/death + 메시지 수신 시각으로 device_connection_state 전이
  (판정 기준: 통신 규격 §5 — 주기 3배 degraded / 10배 offline / death 즉시 offline)
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import aiomqtt
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from middleware.app import models as m
from middleware.app.config import settings
from shared.schemas import (
    Birth,
    Death,
    RobotStatusMsg,
    SensorReading,
    parse_message,
)
from shared.schemas import topics

log = logging.getLogger("mw.ingest")

DEGRADED_FACTOR = 3
OFFLINE_FACTOR = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _touch_connection(conn, farm_id: str, device_id: str, received_at: datetime) -> None:
    """메시지 수신 → last_received_at 갱신 + (offline 아니면) online 복귀."""
    stmt = (
        insert(m.device_connection_state)
        .values(farm_id=farm_id, device_id=device_id, state="online",
                last_received_at=received_at, updated_at=received_at)
        .on_conflict_do_update(
            constraint="uq_dcs_farm_device",
            set_={"last_received_at": received_at, "state": "online",
                  "updated_at": received_at},
        )
    )
    await conn.execute(stmt)


async def _handle_sensor_reading(conn, msg: SensorReading, received_at: datetime) -> None:
    await conn.execute(
        insert(m.environment_reading)
        .values(
            ts=msg.timestamp, received_at=received_at, farm_id=msg.farm_id,
            device_id=msg.device_id, sensor_id=msg.sensor_id, sensor_type=msg.sensor_type,
            value=msg.value, unit=msg.unit, sensor_state=msg.sensor_state,
        )
        .on_conflict_do_nothing()  # QoS1 중복 배달 멱등 (PK: farm_id,sensor_id,ts)
    )
    await conn.execute(
        update(m.sensor)
        .where(m.sensor.c.farm_id == msg.farm_id, m.sensor.c.sensor_id == msg.sensor_id,
               (m.sensor.c.last_ts.is_(None)) | (m.sensor.c.last_ts <= msg.timestamp))
        .values(last_value=msg.value, last_ts=msg.timestamp, sensor_state=msg.sensor_state)
    )


async def _handle_robot_status(conn, msg: RobotStatusMsg, received_at: datetime) -> None:
    pos = msg.position
    await conn.execute(
        insert(m.robot_status)
        .values(
            ts=msg.timestamp, received_at=received_at, farm_id=msg.farm_id,
            device_id=msg.device_id,
            pos_x=pos.x if pos else None, pos_y=pos.y if pos else None,
            pos_frame=pos.frame if pos else None,
            speed=msg.speed, battery_pct=msg.battery_pct, charging=msg.charging,
            mission_state=msg.mission_state, current_task_id=msg.current_task_id,
            error=msg.error,
        )
        .on_conflict_do_nothing()
    )


async def _handle_birth(conn, msg: Birth, received_at: datetime) -> None:
    metrics = [mt.model_dump() for mt in msg.metrics]
    stmt = (
        insert(m.device_connection_state)
        .values(
            farm_id=msg.farm_id, device_id=msg.device_id, state="online",
            last_birth_at=msg.timestamp, last_received_at=received_at,
            birth_metrics=metrics, publish_interval_sec=msg.publish_interval_sec,
            updated_at=received_at,
        )
        .on_conflict_do_update(
            constraint="uq_dcs_farm_device",
            set_={"state": "online", "last_birth_at": msg.timestamp,
                  "last_received_at": received_at, "birth_metrics": metrics,
                  "publish_interval_sec": msg.publish_interval_sec, "updated_at": received_at},
        )
    )
    await conn.execute(stmt)
    log.info("birth: %s/%s (metrics=%d)", msg.farm_id, msg.device_id, len(metrics))


async def _handle_death(conn, msg: Death, device_type: str, received_at: datetime) -> None:
    """death → 즉시 offline.

    LWT death 의 timestamp 는 접속 시점 생성이라 신뢰할 수 없으므로 가드 없이
    적용한다. 정상 재접속 시의 오래된 retained death 는 발행 측(엣지)이
    재접속 직후 빈 retained 발행으로 삭제한다.
    """
    cond = m.device_connection_state.c.farm_id == msg.farm_id
    if device_type == "edge":
        # 엣지 연결이 곧 전체 장치의 통로 — 농장 전체 장치를 offline 처리 (페일세이프 ②)
        log.warning("edge death: %s — 농장 전체 장치 offline 전이", msg.farm_id)
    else:
        cond = cond & (m.device_connection_state.c.device_id == msg.device_id)
    await conn.execute(
        update(m.device_connection_state)
        .where(cond)
        .values(state="offline", last_death_at=msg.timestamp, updated_at=received_at)
    )


async def handle_message(engine: AsyncEngine, topic_str: str, payload: bytes) -> None:
    parsed = topics.parse_topic(topic_str)
    if parsed is None:
        return
    if not payload:  # 빈 retained 발행(retained 삭제 신호)은 무시
        return
    try:
        msg = parse_message(payload)
    except ValidationError as e:
        log.warning("invalid message on %s: %s", topic_str, e.errors()[:2])
        return

    received_at = _now()
    async with engine.begin() as conn:
        if isinstance(msg, SensorReading):
            await _handle_sensor_reading(conn, msg, received_at)
            await _touch_connection(conn, msg.farm_id, msg.device_id, received_at)
        elif isinstance(msg, RobotStatusMsg):
            await _handle_robot_status(conn, msg, received_at)
            await _touch_connection(conn, msg.farm_id, msg.device_id, received_at)
        elif isinstance(msg, Birth):
            await _handle_birth(conn, msg, received_at)
        elif isinstance(msg, Death):
            await _handle_death(conn, msg, parsed.device_type, received_at)
        # ack 는 증분 4(커맨드 변환기), estop_state 는 증분 7 에서 처리


async def ingest_loop(engine: AsyncEngine) -> None:
    """엣지 토픽 구독 루프 — 재접속 포함."""
    while True:
        try:
            async with aiomqtt.Client(
                settings.mqtt_host, settings.mqtt_port, keepalive=30,
                identifier="mw-ingest",
            ) as client:
                await client.subscribe(f"{topics.PREFIX}/#", qos=1)
                log.info("ingest: subscribed %s/# @ %s", topics.PREFIX, settings.mqtt_host)
                async for message in client.messages:
                    try:
                        await handle_message(engine, str(message.topic), message.payload)
                    except Exception:  # 메시지 1건 실패가 루프를 죽이지 않게
                        log.exception("ingest: handler error on %s", message.topic)
        except aiomqtt.MqttError as e:
            log.warning("ingest: mqtt disconnected (%s) — 5s 후 재접속", e)
            await asyncio.sleep(5)


async def connection_monitor(engine: AsyncEngine) -> None:
    """주기 판정 — 수신 공백이 주기의 3배면 degraded, 10배면 offline (§5)."""
    while True:
        await asyncio.sleep(settings.conn_check_interval_sec)
        now = _now()
        try:
            async with engine.begin() as conn:
                rows = (await conn.execute(select(m.device_connection_state))).mappings().all()
                for row in rows:
                    interval = row["publish_interval_sec"]
                    if interval is None:
                        # 주기 발행이 없는 장치(엣지 컨트롤러 등)는 LWT 로만 판정
                        continue
                    last = row["last_received_at"]
                    if last is None or row["state"] == "offline":
                        continue
                    gap = (now - last).total_seconds()
                    new_state = None
                    if gap > interval * OFFLINE_FACTOR:
                        new_state = "offline"
                    elif gap > interval * DEGRADED_FACTOR:
                        new_state = "degraded"
                    if new_state and new_state != row["state"]:
                        await conn.execute(
                            update(m.device_connection_state)
                            .where(m.device_connection_state.c.id == row["id"])
                            .values(state=new_state, updated_at=now)
                        )
                        log.info("connection: %s/%s %s → %s (gap=%.0fs)",
                                 row["farm_id"], row["device_id"], row["state"], new_state, gap)
        except Exception:
            log.exception("connection_monitor error")
