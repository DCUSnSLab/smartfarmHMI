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
    Layout,
    RobotStatusMsg,
    SensorReading,
    parse_message,
)
from shared.schemas import topics

log = logging.getLogger("mw.ingest")

DEGRADED_FACTOR = 3
OFFLINE_FACTOR = 10
# 배수만 쓰면 발행이 빠른 장치일수록 판정이 조여진다 — 2초 주기 로봇은 6초
# 침묵에 degraded 가 된다. 화면을 촘촘히 보려고 주기를 내린 것이 통신 감시를
# 예민하게 만들면 안 되므로 하한을 둔다. 잠정치 (OPN-04).
MIN_DEGRADED_SEC = 20
MIN_OFFLINE_SEC = 60


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
            extra=msg.model_extra or {},  # 계약 밖 확장 필드 보존 (extra="allow")
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
            phase=msg.phase, current_task_id=msg.current_task_id,
            error=msg.error.model_dump(mode="json") if msg.error else None,
            # 엣지 확장 필드(heading_rad 등) 보존 — 지도 렌더가 방향 표시에 쓴다.
            # position 은 선언 필드라 model_extra 에 안 들어온다.
            extra=msg.model_extra or {},
        )
        .on_conflict_do_nothing()
    )


async def _handle_layout(conn, msg: Layout, received_at: datetime) -> None:
    """배치도 자기기술 → DB 영속 (§4.9.1).

    retained 만 믿으면 엣지·브로커가 모두 내려간 동안 도면이 사라진다. 배치도는
    연결과 무관하게 보여야 하므로 수신 즉시 적재한다. 엣지가 진실의 원천이라
    같은 layout 을 통째로 교체한다 — 부분 갱신은 사라진 구역을 남긴다.
    """
    layout_id = (
        await conn.execute(
            insert(m.farm_layout)
            .values(
                farm_id=msg.farm_id, coord_frame=msg.frame,
                origin_desc="엣지 지도(SD map) 작성 기준점",
                scale={"unit": "m", "ratio": 1.0},
                source="edge", source_device_id=msg.device_id, updated_at=received_at,
            )
            .on_conflict_do_update(
                index_elements=["farm_id"],
                set_={"coord_frame": msg.frame, "source": "edge",
                      "source_device_id": msg.device_id, "updated_at": received_at},
            )
            .returning(m.farm_layout.c.id)
        )
    ).scalar_one()

    await conn.execute(
        m.layout_element.delete().where(m.layout_element.c.layout_id == layout_id)
    )
    # executemany 는 첫 행의 키로 INSERT 문을 만든다 — 구역 행과 지점 행의 키가
    # 다르면 뒤쪽 그룹에서 바인드 파라미터가 비어 실패한다. 모든 행을 같은
    # 모양으로 채운다.
    def _row(**kw) -> dict:
        return {"layout_id": layout_id, "element_id": None, "zone": None, "zone_type": None,
                "geometry": None, "connects": None, "x": None, "y": None, **kw}

    # 세 종류는 서로 다른 개념이다 — 존은 주행 공간, 게이트는 존 사이 통로,
    # 지점은 작업 대상. 지점은 존 안에 있으므로 zone 이 소속을 가리키고,
    # 존 자신의 종류는 zone_type 이다 (두 개를 한 칸에 넣으면 소속이 사라진다).
    rows = [
        _row(element_type="zone", element_id=z.id, zone_type=z.zone_type,
             geometry=[list(p) for p in z.polygon])
        for z in msg.zones
    ] + [
        _row(element_type="gate", element_id=g.id, connects=g.between,
             geometry=[list(p) for p in g.segment])
        for g in msg.gates
    ] + [
        _row(element_type=p.point_type, element_id=p.id, x=p.x, y=p.y, zone=p.zone)
        for p in msg.points
    ]
    if rows:
        await conn.execute(insert(m.layout_element), rows)
    log.info(
        "layout: %s/%s (zones=%d gates=%d points=%d frame=%s)",
        msg.farm_id, msg.device_id, len(msg.zones), len(msg.gates), len(msg.points), msg.frame,
    )


async def _handle_birth(conn, msg: Birth, received_at: datetime, retained: bool = False) -> None:
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
    if not retained:
        await _check_duplicate_publisher(conn, msg, received_at)


# 같은 (farm, device) 로 발행자가 둘이면 토픽이 통째로 겹친다. 두 현장의 데이터가
# 한 농장으로 섞이고, 한쪽이 끊기면 LWT 가 다른 쪽까지 오프라인으로 만든다.
# 브로커는 client id 가 같을 때만 끊어 주는데 그것도 조용해서, 데이터가 번갈아
# 들어오는 동안에는 정상으로 보인다. 엣지가 birth 에 싣는 instance_id(프로세스마다
# 다른 값)로 가려낸다.
#
# 판정 기준은 death 다. 재시작은 death → birth 순서라 앞의 것이 지워지고 새 값이
# 그냥 등록된다. death 없이 값만 바뀌면 먼저 있던 발행자가 아직 살아 있다는 뜻이다.
#
# 보관본(retained) birth 는 이 판정에 넣지 않는다 — 경고도, 기록도. 그건 "그 토픽에
# 마지막으로 실린 값"일 뿐 발행자가 지금 살아 있다는 증거가 아니다. 미들웨어가
# 재시작하면 죽은 엣지가 남긴 birth 까지 다시 읽는데, 그걸 기록해 두면 진짜 엣지가
# 붙을 때 instance 가 달라 중복으로 오탐한다. 기록만 하고 경고를 미뤄도 같은 결과다.
# 실황과 보관본은 브로커가 구분해 준다 — 재생본에만 RETAIN 플래그가 서고, 살아 있는
# 발행자의 메시지는 retain=true 로 보냈어도 플래그 0 으로 배달된다. 그래서 진짜
# 중복(둘 다 실황)은 이 제외로 놓치지 않는다.
_seen_instances: dict[tuple[str, str], str] = {}


async def _check_duplicate_publisher(conn, msg: Birth, received_at: datetime) -> None:
    instance = (msg.model_extra or {}).get("instance_id")
    if not instance:
        return   # 확장 필드다. 안 싣는 엣지는 판정하지 않는다
    key = (msg.farm_id, msg.device_id)
    prev = _seen_instances.get(key)
    _seen_instances[key] = instance
    if prev is not None and prev != instance:
        log.error(
            "발행자 중복 의심: %s/%s — 앞의 발행자가 내려간 기록 없이 다른 instance 가 "
            "birth 를 보냄. 같은 farm_id 로 엣지가 둘 이상 붙어 있는지 확인",
            msg.farm_id, msg.device_id,
        )


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
    # 발행자가 내려갔다 — 다음 birth 는 재시작이지 중복이 아니다.
    if device_type == "edge":
        for key in [k for k in _seen_instances if k[0] == msg.farm_id]:
            _seen_instances.pop(key, None)
    else:
        _seen_instances.pop((msg.farm_id, msg.device_id), None)


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
    engine: AsyncEngine, topic_str: str, payload: bytes, publisher=None,
    retained: bool = False,
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
        await _dispatch(engine, parsed, msg, received_at, publisher, retained)
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


async def _dispatch(engine, parsed, msg, received_at, publisher, retained=False) -> None:
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
            if msg.error:
                from middleware.app.alerts import alert_robot_error
                await alert_robot_error(conn, publisher, msg.farm_id, msg.device_id,
                                        msg.error.model_dump(mode="json"))
            if publisher:
                publisher.publish(msg.farm_id, "robot", {
                    "device_id": msg.device_id,
                    "pos_x": msg.position.x if msg.position else None,
                    "pos_y": msg.position.y if msg.position else None,
                    "pos_frame": msg.position.frame if msg.position else None,
                    # 배치도에 로봇 방향을 그리려면 실시간 스트림에도 실어야 한다.
                    "heading_rad": (msg.model_extra or {}).get("heading_rad"),
                    "speed": msg.speed, "battery_pct": msg.battery_pct,
                    "charging": msg.charging, "phase": msg.phase,
                    # 오류는 phase 를 덮지 않고 나란히 간다 (§4.2) — 화면도 둘 다 그린다.
                    "error": msg.error.model_dump(mode="json") if msg.error else None,
                    "ts": msg.timestamp.isoformat(),
                })
        elif isinstance(msg, Layout):
            await _handle_layout(conn, msg, received_at)
            await _touch_connection(conn, msg.farm_id, msg.device_id, received_at)
            if publisher:
                publisher.publish(msg.farm_id, "layout", {
                    "device_id": msg.device_id, "frame": msg.frame,
                    "zones": len(msg.zones), "gates": len(msg.gates),
                    "points": len(msg.points),
                })
        elif isinstance(msg, Birth):
            await _handle_birth(conn, msg, received_at, retained)
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
                        await handle_message(
                            engine, str(message.topic), message.payload, publisher,
                            retained=bool(message.retain),
                        )
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
                # 소프트 삭제된 장치는 판정 대상이 아니다 — 떼어낸 장비는 당연히
                # 소식이 없고, 그대로 두면 장비를 뗄 때마다 통신 단절 알림이
                # 하나씩 영구히 쌓여 진짜 고장이 그 사이에 묻힌다.
                rows = (await conn.execute(
                    select(m.device_connection_state).where(
                        m.not_soft_deleted(
                            m.device_connection_state.c.farm_id,
                            m.device_connection_state.c.device_id,
                        )
                    )
                )).mappings().all()
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
                    if gap > max(interval * OFFLINE_FACTOR, MIN_OFFLINE_SEC):
                        new_state = "offline"
                    elif gap > max(interval * DEGRADED_FACTOR, MIN_DEGRADED_SEC):
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
