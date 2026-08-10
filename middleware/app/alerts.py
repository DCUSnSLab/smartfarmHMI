"""알림 엔진 + 알림 REST — component-internals.md §3 (FR-32~34).

수집 데이터·통신 상태·명령 실패를 alert_rule 과 대조해 alert 를 생성하고
내부 'alert' 스트림으로 재발행한다. 같은 대상의 **미확인 알림이 있으면
중복 생성하지 않는다** (읽음 처리 후에만 재발생).

심각도 3단계 (디자인 전달본): warning(경고)/caution(주의)/info(완료·정보).
임계 기본값은 잠정이다 — OPN-20.
"""

import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m

log = logging.getLogger("mw.alerts")

router = APIRouter(prefix="/internal")

SENSOR_LABEL = {
    "temperature": ("내부온도", "℃"), "humidity": ("습도", "%"), "ec": ("양분(EC)", ""),
    "co2": ("CO₂", "ppm"), "illuminance": ("조도", "klx"), "power": ("소모전력", "kW"),
}

# ── 규칙 캐시 (farm_id → (rules, loaded_at)) — 센서 메시지마다 DB 조회 방지 ──
_rules_cache: dict[str, tuple[list[dict], float]] = {}
RULES_TTL_SEC = 30


def invalidate_rules(farm_id: str) -> None:
    _rules_cache.pop(farm_id, None)


async def _threshold_rules(conn, farm_id: str) -> list[dict]:
    cached = _rules_cache.get(farm_id)
    if cached and time.monotonic() - cached[1] < RULES_TTL_SEC:
        return cached[0]
    rows = (
        (await conn.execute(
            select(m.alert_rule).where(
                m.alert_rule.c.farm_id == farm_id,
                m.alert_rule.c.alert_kind == "threshold",
                m.alert_rule.c.enabled,
            )
        )).mappings().all()
    )
    rules = [dict(r) for r in rows]
    _rules_cache[farm_id] = (rules, time.monotonic())
    return rules


async def create_alert(
    conn, publisher, *, farm_id: str, severity: str, alert_kind: str,
    title: str, body: str | None = None, device_id: str | None = None,
    deeplink: str | None = None, rule_id: int | None = None,
    dedup_key: str | None = None,
) -> bool:
    """알림 생성 + 스트림 재발행. dedup_key 가 같은 미확인 알림이 있으면 건너뛴다."""
    if dedup_key:
        exists = (
            await conn.execute(
                select(m.alert.c.id).where(
                    m.alert.c.farm_id == farm_id,
                    m.alert.c.acked_at.is_(None),
                    text("extra->>'dedup_key' = :dk").bindparams(dk=dedup_key),
                ).limit(1)
            )
        ).first()
        if exists:
            return False

    occurred_at = datetime.now(timezone.utc)
    row = (
        await conn.execute(
            insert(m.alert).values(
                farm_id=farm_id, severity=severity, alert_kind=alert_kind,
                device_id=device_id, title=title, body=body, deeplink=deeplink,
                occurred_at=occurred_at, rule_id=rule_id,
                extra={"dedup_key": dedup_key} if dedup_key else {},
            ).returning(m.alert.c.id)
        )
    ).first()
    if publisher:
        publisher.publish(farm_id, "alert", {
            "id": row[0], "farm_id": farm_id, "severity": severity,
            "alert_kind": alert_kind,
            "device_id": device_id, "title": title, "body": body,
            "deeplink": deeplink, "occurred_at": occurred_at.isoformat(), "acked_at": None,
        })
    log.info("alert: [%s] %s (%s)", severity, title, farm_id)
    return True


async def check_sensor_thresholds(conn, msg, publisher) -> None:
    """센서값 임계 검사 (FR-32 threshold) — ingest 의 sensor_reading 훅."""
    for rule in await _threshold_rules(conn, msg.farm_id):
        if rule["sensor_type"] != msg.sensor_type:
            continue
        label, unit = SENSOR_LABEL.get(msg.sensor_type, (msg.sensor_type, msg.unit))
        breach = None
        if rule["max_value"] is not None and msg.value > rule["max_value"]:
            breach = ("상한", rule["max_value"])
        elif rule["min_value"] is not None and msg.value < rule["min_value"]:
            breach = ("하한", rule["min_value"])
        if breach is None:
            continue
        await create_alert(
            conn, publisher, farm_id=msg.farm_id, severity="warning",
            alert_kind="threshold", device_id=msg.device_id,
            title=f"{label} {msg.value}{unit} {breach[0]} 초과",
            body=f"허용 범위 {rule['min_value']}~{rule['max_value']}{unit} · 센서 {msg.sensor_id}",
            deeplink=f"/farms/{msg.farm_id}/env", rule_id=rule["id"],
            dedup_key=f"threshold:{msg.sensor_id}:{breach[0]}",
        )


async def alert_connection_change(conn, publisher, farm_id: str, device_id: str,
                                  state: str) -> None:
    """통신 상태 전이 알림 (FR-32 connection ← FR-37)."""
    if state == "online":
        return
    severity = "warning" if state == "offline" else "caution"
    label = "오프라인" if state == "offline" else "응답 지연"
    await create_alert(
        conn, publisher, farm_id=farm_id, severity=severity, alert_kind="connection",
        device_id=device_id, title=f"{device_id} {label}",
        body="통신 상태를 확인하세요" if state == "offline" else "점검 권장",
        deeplink=f"/farms/{farm_id}/status", dedup_key=f"connection:{device_id}",
    )


async def alert_robot_error(conn, publisher, farm_id: str, device_id: str, error) -> None:
    """로봇 오류 알림 (FR-32 robot_error ← 통신 규격 §4.2).

    0.2 까지 `error` 는 적재만 되고 흔적을 남기지 않아, 서버가 발행하지 않은
    명령의 실패가 알림도 이력도 없이 사라졌다 (`edge-state-recovery.md` 할 일 3).

    dedup_key 에 `code` 를 넣어 오류 종류가 바뀌면 새 알림이 뜨고, 같은 오류가
    이어지는 동안에는 재생성되지 않는다 — 사건이므로 전이에서만 울려야 한다.
    alert_kind 는 FR-32 의 "장비 이상"(`device_fault`)이다.
    """
    code = error.get("code") if isinstance(error, dict) else getattr(error, "code", None)
    if not code:
        return
    message = error.get("message") if isinstance(error, dict) else getattr(error, "message", None)
    severity = (
        error.get("severity") if isinstance(error, dict) else getattr(error, "severity", None)
    ) or "warning"
    await create_alert(
        conn, publisher, farm_id=farm_id, severity=severity, alert_kind="device_fault",
        device_id=device_id, title=f"{device_id} 오류 — {code}",
        body=message or "로봇이 오류를 보고했습니다",
        deeplink=f"/farms/{farm_id}/robot",
        dedup_key=f"robot_error:{device_id}:{code}",
    )


async def alert_command_failure(conn, publisher, farm_id: str, device_id: str,
                                command_id: str, status: str) -> None:
    """명령 실패·타임아웃 알림 (FR-32 task_failed)."""
    label = "응답 없음(타임아웃)" if status == "timeout" else "실패"
    await create_alert(
        conn, publisher, farm_id=farm_id, severity="caution", alert_kind="task_failed",
        device_id=device_id, title=f"제어 명령 {label}",
        body=f"명령 {command_id} · 장치 {device_id}",
        deeplink=f"/farms/{farm_id}/env",
        # 키에 명령 id 를 넣는다 — 장치 단위로만 잡으면(task_failed:{device_id}) 확인하지
        # 않은 알림 하나가 그 장치의 이후 모든 실패를 가린다. 명령 실패는 조작 한 건에
        # 대응하는 사건이라 억제 대상이 아니다 (상태 알림인 connection·threshold 와 다름).
        # command_id 는 전역 유일하므로, 같은 명령이 실패·타임아웃으로 두 번 잡히는
        # 경우는 여전히 한 건으로 합쳐진다.
        dedup_key=f"task_failed:{device_id}:{command_id}",
    )


# ── REST (내부 — 애플리케이션 서버 전용) ──────────────────────

def _deps():
    from middleware.app.main import engine, publisher
    return engine, publisher


@router.get("/alerts")
async def list_all_alerts(unacked: bool = False, limit: int = 100):
    """전 농장 알림 — 통합 대시보드 KPI·전역 알림 화면 (FR-33·38)."""
    engine, _ = _deps()
    stmt = select(m.alert)
    if unacked:
        stmt = stmt.where(m.alert.c.acked_at.is_(None))
    stmt = stmt.order_by(m.alert.c.occurred_at.desc()).limit(min(limit, 300))
    async with engine.connect() as conn:
        rows = (await conn.execute(stmt)).mappings().all()
    return [
        {"id": r["id"], "farm_id": r["farm_id"], "severity": r["severity"],
         "alert_kind": r["alert_kind"], "device_id": r["device_id"], "title": r["title"],
         "body": r["body"], "deeplink": r["deeplink"],
         "occurred_at": r["occurred_at"].isoformat(),
         "acked_at": r["acked_at"].isoformat() if r["acked_at"] else None}
        for r in rows
    ]


@router.get("/farms/{farm_id}/alerts")
async def list_alerts(farm_id: str, unacked: bool = False, severity: str | None = None,
                      limit: int = 50):
    engine, _ = _deps()
    stmt = select(m.alert).where(m.alert.c.farm_id == farm_id)
    if unacked:
        stmt = stmt.where(m.alert.c.acked_at.is_(None))
    if severity:
        stmt = stmt.where(m.alert.c.severity == severity)
    stmt = stmt.order_by(m.alert.c.occurred_at.desc()).limit(min(limit, 200))
    async with engine.connect() as conn:
        rows = (await conn.execute(stmt)).mappings().all()
    return [
        {"id": r["id"], "farm_id": r["farm_id"], "severity": r["severity"],
         "alert_kind": r["alert_kind"],
         "device_id": r["device_id"], "title": r["title"], "body": r["body"],
         "deeplink": r["deeplink"], "occurred_at": r["occurred_at"].isoformat(),
         "acked_at": r["acked_at"].isoformat() if r["acked_at"] else None}
        for r in rows
    ]


class AckRequest(BaseModel):
    by: str | None = None


@router.post("/alerts/{alert_id}/ack")
async def ack_alert(alert_id: int, req: AckRequest):
    engine, publisher = _deps()
    now = datetime.now(timezone.utc)
    async with engine.begin() as conn:
        row = (
            await conn.execute(
                update(m.alert)
                .where(m.alert.c.id == alert_id, m.alert.c.acked_at.is_(None))
                .values(acked_at=now, acked_by=req.by)
                .returning(m.alert.c.farm_id)
            )
        ).first()
    if row is None:
        raise HTTPException(404, "미확인 알림이 아닙니다")
    publisher.publish(row[0], "alert", {"id": alert_id, "acked_at": now.isoformat()})
    return {"ok": True}


@router.post("/farms/{farm_id}/alerts/ack-all")
async def ack_all(farm_id: str, req: AckRequest):
    engine, publisher = _deps()
    now = datetime.now(timezone.utc)
    async with engine.begin() as conn:
        result = await conn.execute(
            update(m.alert)
            .where(m.alert.c.farm_id == farm_id, m.alert.c.acked_at.is_(None))
            .values(acked_at=now, acked_by=req.by)
        )
    publisher.publish(farm_id, "alert", {"ack_all": True, "acked_at": now.isoformat()})
    return {"acked": result.rowcount}


@router.get("/farms/{farm_id}/alert-rules")
async def list_rules(farm_id: str):
    engine, _ = _deps()
    async with engine.connect() as conn:
        rows = (
            (await conn.execute(
                select(m.alert_rule).where(m.alert_rule.c.farm_id == farm_id)
                .order_by(m.alert_rule.c.id)
            )).mappings().all()
        )
    return [
        {"id": r["id"], "alert_kind": r["alert_kind"], "sensor_type": r["sensor_type"],
         "min_value": r["min_value"], "max_value": r["max_value"], "enabled": r["enabled"]}
        for r in rows
    ]


class RuleUpdate(BaseModel):
    min_value: float | None = None
    max_value: float | None = None
    enabled: bool | None = None
    updated_by: str | None = None


@router.put("/alert-rules/{rule_id}")
async def update_rule(rule_id: int, req: RuleUpdate):
    engine, _ = _deps()
    values = {k: v for k, v in req.model_dump().items() if v is not None and k != "updated_by"}
    values["updated_by"] = req.updated_by
    values["updated_at"] = datetime.now(timezone.utc)
    async with engine.begin() as conn:
        row = (
            await conn.execute(
                update(m.alert_rule).where(m.alert_rule.c.id == rule_id)
                .values(**values).returning(m.alert_rule.c.farm_id)
            )
        ).first()
    if row is None:
        raise HTTPException(404, "규칙을 찾을 수 없습니다")
    invalidate_rules(row[0])
    return {"ok": True}
