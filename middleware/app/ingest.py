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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from middleware.app import conformance
from middleware.app import models as m
from middleware.app.config import settings
from shared.schemas import (
    Ack,
    Birth,
    Death,
    EstopState,
    Heartbeat,
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


# farm 활성 상태 캐시 — 텔레메트리 고빈도 경로에서 매번 SELECT 하지 않도록 짧게 캐싱.
_farm_active_cache: dict[str, bool] = {}
_farm_cache_at: datetime | None = None
_FARM_CACHE_TTL = timedelta(seconds=10)


async def _is_farm_active(engine: AsyncEngine, farm_id: str) -> bool | None:
    """farm.is_active 반환. 행이 없으면 None (미등록). 10초 캐시."""
    global _farm_cache_at
    now = _now()
    if _farm_cache_at is None or (now - _farm_cache_at) > _FARM_CACHE_TTL:
        async with engine.connect() as conn:
            rows = (await conn.execute(select(m.farm.c.farm_id, m.farm.c.is_active))).all()
        _farm_active_cache.clear()
        _farm_active_cache.update({r.farm_id: r.is_active for r in rows})
        _farm_cache_at = now
    return _farm_active_cache.get(farm_id)


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
            farm_id=msg.farm_id, device_id=msg.device_id, device_type=msg.device_type,
            state="online", last_birth_at=msg.timestamp, last_received_at=received_at,
            birth_metrics=metrics, publish_interval_sec=msg.publish_interval_sec,
            updated_at=received_at,
        )
        .on_conflict_do_update(
            constraint="uq_dcs_farm_device",
            set_={"state": "online", "device_type": msg.device_type,
                  "last_birth_at": msg.timestamp,
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


async def _record_pending(engine: AsyncEngine, parsed, msg) -> None:
    """미등록 팜/장치를 발견 버퍼(pending_registration)에 기록 — 설정 화면 '발견' 소스.

    메인 dispatch 는 FK 위반으로 롤백됐으므로 **별도 트랜잭션**으로 쓴다.
    device_type 은 토픽에서(항상 존재), 센서 자기기술은 birth.metrics / telemetry 에서 얻어
    (farm_id, device_id) 단위로 누적 병합한다.
    """
    device_type, device_id = parsed.device_type, parsed.device_id
    publish_interval = getattr(msg, "publish_interval_sec", None)
    incoming: list[dict] = []
    if isinstance(msg, Birth):
        incoming = [
            {"sensor_id": mt.sensor_id, "sensor_type": mt.sensor_type, "unit": mt.unit}
            for mt in msg.metrics
        ]
    elif isinstance(msg, SensorReading):
        incoming = [{"sensor_id": msg.sensor_id, "sensor_type": msg.sensor_type, "unit": msg.unit}]
    now = _now()
    try:
        async with engine.begin() as conn:
            row = (
                await conn.execute(
                    select(
                        m.pending_registration.c.sensors,
                        m.pending_registration.c.msg_count,
                        m.pending_registration.c.publish_interval_sec,
                    ).where(
                        m.pending_registration.c.farm_id == msg.farm_id,
                        m.pending_registration.c.device_id == device_id,
                    )
                )
            ).first()
            if row is None:
                await conn.execute(
                    insert(m.pending_registration).values(
                        farm_id=msg.farm_id, device_id=device_id, device_type=device_type,
                        sensors=incoming, publish_interval_sec=publish_interval,
                        first_seen=now, last_seen=now, msg_count=1,
                    )
                )
            else:
                merged = {s["sensor_id"]: s for s in (row.sensors or [])}
                for s in incoming:
                    merged[s["sensor_id"]] = s
                await conn.execute(
                    update(m.pending_registration)
                    .where(
                        m.pending_registration.c.farm_id == msg.farm_id,
                        m.pending_registration.c.device_id == device_id,
                    )
                    .values(
                        device_type=device_type,
                        sensors=list(merged.values()),
                        publish_interval_sec=publish_interval
                        if publish_interval is not None
                        else row.publish_interval_sec,
                        last_seen=now,
                        msg_count=row.msg_count + 1,
                    )
                )
    except Exception:  # 발견 기록 실패가 수집 루프를 막지 않게
        log.exception("pending_registration upsert 실패: %s/%s", msg.farm_id, device_id)


async def handle_message(
    engine: AsyncEngine, topic_str: str, payload: bytes, publisher=None
) -> None:
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

    # 계약 적합성 — 버전 호환 판정 + 필드명 오타 검출 (conformance.py).
    # 스키마 검증만으로는 extra="allow" 때문에 오타가 그대로 통과한다.
    if not conformance.inspect(msg):
        return

    received_at = _now()
    # 비활성(소프트 삭제) 팜 — 데이터를 적재하지 않고 발견 버퍼로 전환해 재발견을 허용한다.
    if await _is_farm_active(engine, msg.farm_id) is False:
        await _record_pending(engine, parsed, msg)
        return
    try:
        await _dispatch(engine, parsed, msg, received_at, publisher)
    except IntegrityError as e:
        # 대표 사례: 미등록 농장의 birth/텔레메트리 (FK 위반) — README 발견 사항.
        # birth 는 접속 시 1회 발행이라, 농장 등록 후 장치가 재접속해야 복구된다.
        log.warning(
            "미등록 농장/장비 메시지 거부: %s/%s (%s) — 농장 등록 후 장치 재접속 필요 [%s]",
            msg.farm_id, getattr(msg, "device_id", "?"), msg.type, e.orig,
        )
        # 발견 버퍼에 기록 — 설정 화면에서 이 팜을 "발견"으로 등록할 수 있게 한다.
        await _record_pending(engine, parsed, msg)


async def _handle_heartbeat(conn, msg: Heartbeat, device_type: str, received_at: datetime) -> None:
    """주기 생존 신호 → 연결 상태 online 갱신 (+ 주기 보존 = 판정 근거).

    주기 데이터가 없는 장치(엣지 컨트롤러)의 liveness 를 birth-once 대신 하트비트로
    유지한다. birth 가 유실됐어도 다음 하트비트에 online 이 자가 복구되고,
    interval_sec 를 보존해 connection_monitor 가 공백 기반 degraded/offline 판정을 한다.
    """
    interval_set = {} if msg.interval_sec is None else {"publish_interval_sec": msg.interval_sec}
    stmt = (
        insert(m.device_connection_state)
        .values(
            farm_id=msg.farm_id, device_id=msg.device_id, device_type=device_type,
            state="online", last_received_at=received_at,
            publish_interval_sec=msg.interval_sec, updated_at=received_at,
        )
        .on_conflict_do_update(
            constraint="uq_dcs_farm_device",
            set_={"state": "online", "device_type": device_type,
                  "last_received_at": received_at, "updated_at": received_at, **interval_set},
        )
    )
    await conn.execute(stmt)


async def _dispatch(engine, parsed, msg, received_at, publisher) -> None:
    async with engine.begin() as conn:
        if isinstance(msg, SensorReading):
            await _handle_sensor_reading(conn, msg, received_at)
            await _touch_connection(conn, msg.farm_id, msg.device_id, received_at)
            from middleware.app.alerts import check_sensor_thresholds
            await check_sensor_thresholds(conn, msg, publisher)  # FR-32 threshold
            if publisher:
                publisher.publish(msg.farm_id, "environment", {
                    "device_id": msg.device_id, "sensor_id": msg.sensor_id,
                    "sensor_type": msg.sensor_type, "value": msg.value, "unit": msg.unit,
                    "sensor_state": msg.sensor_state, "ts": msg.timestamp.isoformat(),
                })
        elif isinstance(msg, RobotStatusMsg):
            await _handle_robot_status(conn, msg, received_at)
            await _touch_connection(conn, msg.farm_id, msg.device_id, received_at)
            if publisher:
                publisher.publish(msg.farm_id, "robot", {
                    "device_id": msg.device_id,
                    "pos_x": msg.position.x if msg.position else None,
                    "pos_y": msg.position.y if msg.position else None,
                    "speed": msg.speed, "battery_pct": msg.battery_pct,
                    "charging": msg.charging, "mission_state": msg.mission_state,
                    "ts": msg.timestamp.isoformat(),
                })
        elif isinstance(msg, Birth):
            await _handle_birth(conn, msg, received_at)
            if publisher:
                publisher.publish(msg.farm_id, "connection", {
                    "device_id": msg.device_id, "state": "online",
                    "last_received_at": received_at.isoformat(),
                })
        elif isinstance(msg, Death):
            await _handle_death(conn, msg, parsed.device_type, received_at)
            from middleware.app.alerts import alert_connection_change
            await alert_connection_change(conn, publisher, msg.farm_id, msg.device_id, "offline")
            if publisher:
                # 엣지 death 는 농장 전체 cascade — 화면은 farm 단위 오프라인 표시
                publisher.publish(msg.farm_id, "connection", {
                    "device_id": msg.device_id, "state": "offline",
                    "cascade": parsed.device_type == "edge",
                    "last_received_at": received_at.isoformat(),
                })
        elif isinstance(msg, Heartbeat):
            await _handle_heartbeat(conn, msg, parsed.device_type, received_at)
            if publisher:
                publisher.publish(msg.farm_id, "connection", {
                    "device_id": msg.device_id, "state": "online",
                    "last_received_at": received_at.isoformat(),
                })
        elif isinstance(msg, Ack):
            from middleware.app.commands import handle_ack  # 순환 import 회피
            await handle_ack(conn, msg, received_at, publisher)
        elif isinstance(msg, EstopState):
            from middleware.app.stop import handle_estop_state
            await handle_estop_state(conn, msg, received_at, publisher)


async def ingest_loop(engine: AsyncEngine, publisher=None) -> None:
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
                        await handle_message(engine, str(message.topic), message.payload, publisher)
                    except Exception:  # 메시지 1건 실패가 루프를 죽이지 않게
                        log.exception("ingest: handler error on %s", message.topic)
        except aiomqtt.MqttError as e:
            log.warning("ingest: mqtt disconnected (%s) — 5s 후 재접속", e)
            await asyncio.sleep(5)


async def connection_monitor(engine: AsyncEngine, publisher=None) -> None:
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
                        from middleware.app.alerts import alert_connection_change
                        await alert_connection_change(
                            conn, publisher, row["farm_id"], row["device_id"], new_state
                        )
                        if publisher:
                            publisher.publish(row["farm_id"], "connection", {
                                "device_id": row["device_id"], "state": new_state,
                                "last_received_at": last.isoformat(),
                            })
        except Exception:
            log.exception("connection_monitor error")
