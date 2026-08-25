"""커맨드 변환기 — component-internals.md §3 (FR-10, 비기능 §4).

제어 요청 → command_log 기록(멱등성 키) → control_command 발행(retain=false)
→ ack 수신·상태 전이 → 타임아웃 처리. "보낸 것"과 "실행된 것"을 구분한다.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.alerts import alert_command_failure
from middleware.app.stop import is_estopped, is_remote_stopped
from shared.schemas import Ack, ControlCommand, RobotJog
from shared.schemas.topics import topic

log = logging.getLogger("mw.commands")

router = APIRouter(prefix="/internal")

# FR-10: 제어 대상은 온·습도·양분·조도(LED) 4종 한정. 환기·차광·천창 명령은 없다.
ALLOWED_COMMANDS = {"set_temperature", "set_humidity", "set_ec", "set_led", "set_auto_mode"}

TERMINAL_STATUSES = ("completed", "failed", "rejected", "timeout")

JOG_DIRECTIONS = {"forward", "backward", "left", "right", "stop"}
JOG_SPEED_MAX = 1.0
# 데드맨 하한·상한 — 반복 주기보다 길고 사람의 반응 시간보다 짧아야 한다 (개정 §3.1).
JOG_DURATION_MS_MIN = 100
JOG_DURATION_MS_MAX = 2000


def _deps():
    from middleware.app.main import engine, publisher  # 런타임 참조 (순환 import 회피)
    return engine, publisher


class ControlRequest(BaseModel):
    command: str
    params: dict = Field(default_factory=dict)
    issued_by: str | None = None
    timeout_sec: int = Field(default=30, ge=1, le=600)


@router.post("/farms/{farm_id}/devices/{device_id}/control")
async def issue_control(farm_id: str, device_id: str, req: ControlRequest):
    """생육기 환경 제어 명령 발행 (FR-10).

    원격 전체 정지 발동 중에는 **여기서 거부**한다 — 차단은 미들웨어가 수행하며
    웹앱 UI 비활성화에 의존하지 않는다 (non-functional.md §2.3).
    """
    if req.command not in ALLOWED_COMMANDS:
        raise HTTPException(400, f"허용되지 않는 명령: {req.command}")
    engine, publisher = _deps()

    async with engine.connect() as conn:
        if await is_remote_stopped(conn, farm_id):
            raise HTTPException(423, "원격 전체 정지 발동 중 — 제어가 차단되었습니다 (FR-35)")

    command_id = f"cmd-{uuid.uuid4().hex[:12]}"
    msg = ControlCommand(
        command_id=command_id, farm_id=farm_id, device_id=device_id,
        command=req.command, params=req.params, issued_by=req.issued_by,
        timeout_sec=req.timeout_sec, timestamp=datetime.now(timezone.utc),
    )
    payload = msg.model_dump_json()

    async with engine.begin() as conn:
        await conn.execute(
            insert(m.command_log).values(
                command_id=command_id, farm_id=farm_id, device_id=device_id,
                command_type="control_command", payload=msg.model_dump(mode="json"),
                issued_by=req.issued_by, timeout_sec=req.timeout_sec,
            )
        )
        if req.command != "set_auto_mode":
            # 수동 설정 이력 보존 — 현재 행 교체 (db-schema: is_current 부분 UNIQUE)
            key = {"set_temperature": "temperature", "set_humidity": "humidity",
                   "set_ec": "ec", "set_led": "led_pct"}[req.command]
            current = (
                (await conn.execute(
                    select(m.device_control_setting).where(
                        m.device_control_setting.c.farm_id == farm_id,
                        m.device_control_setting.c.device_id == device_id,
                        m.device_control_setting.c.is_current,
                    )
                )).mappings().first()
            )
            targets = dict(current["targets"]) if current else {}
            targets[key] = req.params.get("target")
            await conn.execute(
                update(m.device_control_setting)
                .where(m.device_control_setting.c.farm_id == farm_id,
                       m.device_control_setting.c.device_id == device_id,
                       m.device_control_setting.c.is_current)
                .values(is_current=False)
            )
            await conn.execute(
                insert(m.device_control_setting).values(
                    farm_id=farm_id, device_id=device_id, mode="manual",
                    targets=targets, set_by=req.issued_by,
                )
            )

    # 명령은 retain=false — 장치 재접속 시 과거 명령 재실행 방지 (통신 규격 §3)
    publisher.publish_raw(topic(farm_id, "growbed", device_id, "command"), payload, retain=False)
    publisher.publish(farm_id, "command", {
        "command_id": command_id, "device_id": device_id, "command": req.command,
        "params": req.params, "status": "issued",
    })
    log.info("control issued: %s %s %s %s", command_id, device_id, req.command, req.params)
    return {"command_id": command_id, "status": "issued"}


class JogRequest(BaseModel):
    direction: str
    speed: float = 0.5
    duration_ms: int = 800
    issued_by: str | None = None


@router.post("/farms/{farm_id}/robots/{device_id}/jog")
async def issue_jog(farm_id: str, device_id: str, req: JogRequest):
    """로봇 이동 조작 (개정 0.3-robot-jog §2).

    `command_log` 에 남기지 않는다 — 누르고 있는 동안 초당 수 건이 나가는 연속
    조작이라 명령 1건의 생명주기를 담는 자리에 1:1 로 넣으면 이력이 뒤덮이고
    timeout_watcher 가 매 건을 감시하게 된다 (개정 §6).
    """
    if req.direction not in JOG_DIRECTIONS:
        raise HTTPException(400, f"허용되지 않는 방향: {req.direction}")
    engine, publisher = _deps()

    # 정지 명령은 막지 않는다 — 정지 방향은 언제나 안전측이다.
    if req.direction != "stop":
        async with engine.connect() as conn:
            if await is_remote_stopped(conn, farm_id):
                raise HTTPException(423, "원격 전체 정지 발동 중 — 조작이 차단되었습니다 (FR-35)")
            if await is_estopped(conn, farm_id):
                raise HTTPException(423, "물리 비상정지 작동 중 — 현장에서 해제해야 합니다 (FR-36)")

    command_id = f"cmd-{uuid.uuid4().hex[:12]}"
    msg = RobotJog(
        command_id=command_id, farm_id=farm_id, device_id=device_id,
        direction=req.direction,
        # 서버가 아는 범위 안에서만 자른다. 물리 상한(m/s)은 엣지 소유 (개정 §3.2).
        speed=min(max(req.speed, 0.0), JOG_SPEED_MAX),
        duration_ms=min(max(req.duration_ms, JOG_DURATION_MS_MIN), JOG_DURATION_MS_MAX),
        issued_by=req.issued_by, timestamp=datetime.now(timezone.utc),
    )
    publisher.publish_raw(
        topic(farm_id, "robot", device_id, "command"), msg.model_dump_json(), retain=False
    )
    publisher.publish(farm_id, "command", {
        "command_id": command_id, "device_id": device_id, "command": "robot_jog",
        "params": {"direction": msg.direction, "speed": msg.speed,
                   "duration_ms": msg.duration_ms},
        "status": "issued",
    })
    log.info("jog issued: %s %s %s", command_id, device_id, msg.direction)
    return {"command_id": command_id, "status": "issued"}


@router.get("/farms/{farm_id}/commands")
async def recent_commands(farm_id: str, limit: int = 20):
    """최근 명령 이력 — UI 초기 로드용."""
    engine, _ = _deps()
    async with engine.connect() as conn:
        rows = (
            (await conn.execute(
                select(m.command_log)
                .where(m.command_log.c.farm_id == farm_id)
                .order_by(m.command_log.c.issued_at.desc())
                .limit(min(limit, 100))
            )).mappings().all()
        )
    return [
        {"command_id": r["command_id"], "device_id": r["device_id"],
         "command": r["payload"].get("command"), "params": r["payload"].get("params"),
         "status": r["status"], "issued_at": r["issued_at"].isoformat(),
         "last_ack_at": r["last_ack_at"].isoformat() if r["last_ack_at"] else None}
        for r in rows
    ]


async def handle_ack(conn, msg: Ack, received_at: datetime, publisher=None) -> None:
    """ack → command_log 상태 전이. 종결 상태는 되돌리지 않는다 (역순 도착 가드)."""
    result = (
        await conn.execute(
            update(m.command_log)
            .where(m.command_log.c.command_id == msg.command_id,
                   m.command_log.c.status.notin_(TERMINAL_STATUSES))
            .values(status=msg.result, last_ack_at=received_at,
                    ack_detail=msg.detail)
            .returning(m.command_log.c.farm_id, m.command_log.c.device_id)
        )
    ).first()
    if result and publisher:
        publisher.publish(msg.farm_id, "command", {
            "command_id": msg.command_id, "device_id": msg.device_id,
            "status": msg.result, "detail": msg.detail,
        })
        log.info("ack: %s → %s", msg.command_id, msg.result)
    if result and msg.result in ("failed", "rejected"):
        await alert_command_failure(conn, publisher, msg.farm_id, msg.device_id,
                                    msg.command_id, msg.result)


async def timeout_watcher(engine, publisher=None, interval_sec: int = 5) -> None:
    """타임아웃 처리 — timeout_sec 내 종결되지 않은 명령을 실패 처리 (비기능 §4)."""
    import asyncio

    while True:
        await asyncio.sleep(interval_sec)
        try:
            async with engine.begin() as conn:
                rows = (
                    await conn.execute(text(
                        "UPDATE mw.command_log SET status='timeout' "
                        "WHERE status IN ('issued','accepted') "
                        "AND issued_at + (timeout_sec || ' seconds')::interval < now() "
                        "RETURNING command_id, farm_id, device_id"
                    ))
                ).all()
            for command_id, farm_id, device_id in rows:
                log.warning("command timeout: %s (%s)", command_id, device_id)
                if publisher:
                    publisher.publish(farm_id, "command", {
                        "command_id": command_id, "device_id": device_id, "status": "timeout",
                    })
                async with engine.begin() as conn:
                    await alert_command_failure(conn, publisher, farm_id, device_id,
                                                command_id, "timeout")
        except Exception:
            log.exception("timeout_watcher error")
