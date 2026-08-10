"""정지 관리자 — component-internals.md §3 (FR-35·36).

두 정지는 성격이 다르다 (non-functional.md §2):
- 원격 전체 정지(remote): IEC 60204-1 Cat.2 운전 정지, **비안전등급**.
  웹앱에서 발동·해제. 발동 중 자동 스케줄·제어 명령을 **미들웨어가 차단**한다.
- 물리 비상정지(physical_estop): ISO 13850 안전 기능. 엣지가 상태를 발행(OPN-19)
  하며 **표시 전용** — 해제 역방향 명령은 존재하지 않는다 (현장 수동 조작만).
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from shared.schemas import EstopState, RemoteStop, RemoteStopRelease, RemoteStopState
from shared.schemas.topics import topic

log = logging.getLogger("mw.stop")

router = APIRouter(prefix="/internal")


def _deps():
    from middleware.app.main import engine, publisher
    return engine, publisher


async def is_remote_stopped(conn, farm_id: str) -> bool:
    """제어 차단 판정 (FR-35) — scope=all 또는 해당 농장의 미해제 원격 정지."""
    row = (
        await conn.execute(
            select(m.stop_event.c.id).where(
                m.stop_event.c.stop_kind == "remote",
                m.stop_event.c.released_at.is_(None),
                (m.stop_event.c.scope == "all") | (m.stop_event.c.farm_id == farm_id),
            ).limit(1)
        )
    ).first()
    return row is not None


async def _edge_devices(conn, farm_id: str | None) -> list[tuple[str, str]]:
    """정지 명령 전달 대상 엣지 — **birth 로 알려진 장치**(연결 상태)에서 찾는다.

    장비 레지스트리(device_meta, 사용자 등록)가 아니라 자기기술(birth) 기준 —
    미등록 농장(테스트 팜 등)에도 정지가 전달된다. offline 엣지에도 발행하지만
    명령은 retain=false 라 미접속 장치가 나중에 받는 일은 없다.
    """
    dcs = m.device_connection_state
    stmt = select(dcs.c.farm_id, dcs.c.device_id).where(dcs.c.device_type == "edge")
    if farm_id:
        stmt = stmt.where(dcs.c.farm_id == farm_id)
    return [(r[0], r[1]) for r in (await conn.execute(stmt)).all()]


async def _all_farm_ids(conn) -> list[str]:
    return [r[0] for r in (await conn.execute(select(m.farm.c.farm_id))).all()]


def _publish_outbox(publisher, outbox: list[tuple[str, str]]) -> None:
    """모아둔 엣지 명령을 발행 — 호출 시점이 커밋 이후여야 한다."""
    for topic_str, payload in outbox:
        publisher.publish_raw(topic_str, payload, retain=False)


def _publish_stop_state(publisher, edges, *, engaged: bool, scope: str,
                        reason: str | None, now: datetime) -> None:
    """정지 '상태'를 retained 로 발행 (§4.6.1).

    §4.6 명령은 retain=false 라 재접속한 엣지에게 도달하지 않는다. 지속되는
    사실은 이쪽이 나른다 — 이게 없으면 정지 발동 중 엣지를 재기동했을 때
    정지가 조용히 풀린다. 명령이 아니므로 command_log 에 남기지 않고 ack 도
    받지 않는다. estop_state 와 대칭인 서버→엣지 방향 상태.
    """
    for farm_id, device_id in edges:
        msg = RemoteStopState(
            farm_id=farm_id, device_id=device_id, engaged=engaged,
            scope=scope, reason=reason, timestamp=now,
        )
        publisher.publish_raw(
            topic(farm_id, "edge", device_id, "stop_state"), msg.model_dump_json(), retain=True
        )


def _stream_payload(kind: str, active: bool, *, scope: str | None = None,
                    engaged_at=None, released_at=None, by=None, reason=None,
                    detail: dict | None = None) -> dict:
    # detail 은 물리 비상정지의 원 보고 {estop, reason, source} — active 는 판정
    # 결과(unknown 도 True)이고 detail 은 엣지가 실제로 뭐라고 했는지다. 화면이
    # "작동됨"과 "확인 필요"를 구분하려면 둘 다 필요하다 (§4.7).
    return {"stop_kind": kind, "active": active, "scope": scope,
            "engaged_at": engaged_at, "released_at": released_at,
            "by": by, "reason": reason, "detail": detail}


class StopRequest(BaseModel):
    scope: str = "all"          # 디자인 전달본 기준 전 농장 정지가 기본
    farm_id: str | None = None  # scope=farm 일 때
    reason: str | None = None
    by: str | None = None


@router.post("/stop")
async def engage_remote_stop(req: StopRequest):
    """원격 전체 정지 발동 (FR-35). 안전 기능이 아니다 — Cat.2 운전 정지."""
    if req.scope not in ("all", "farm") or (req.scope == "farm" and not req.farm_id):
        raise HTTPException(400, "scope=all 또는 scope=farm+farm_id")
    engine, publisher = _deps()
    now = datetime.now(timezone.utc)
    outbox: list[tuple[str, str]] = []

    async with engine.begin() as conn:
        # 같은 범위 미해제 정지 중복 방지 (부분 UNIQUE 인덱스와 이중 방어).
        # scope=farm 은 farm_id 까지 일치해야 중복 — 서로 다른 농장은 각각 발동 가능
        dup_cond = [
            m.stop_event.c.stop_kind == "remote",
            m.stop_event.c.released_at.is_(None),
            m.stop_event.c.scope == req.scope,
        ]
        if req.scope == "farm":
            dup_cond.append(m.stop_event.c.farm_id == req.farm_id)
        exists = (
            await conn.execute(select(m.stop_event.c.id).where(*dup_cond).limit(1))
        ).first()
        if exists:
            raise HTTPException(409, "이미 원격 전체 정지가 발동 중입니다")

        await conn.execute(
            insert(m.stop_event).values(
                stop_kind="remote", scope=req.scope, farm_id=req.farm_id,
                engaged_at=now, engaged_by=req.by, reason=req.reason,
                command_id=None,  # 명령은 엣지마다 개별 발급 — 단일 참조가 성립하지 않는다
            )
        )
        edges = await _edge_devices(conn, req.farm_id if req.scope == "farm" else None)
        farms = [req.farm_id] if req.scope == "farm" else await _all_farm_ids(conn)
        for farm_id, device_id in edges:
            # 엣지 1대 = 명령 1건. device_id 는 농장 내에서만 유일해 키 재료로 쓸 수 없고
            # (농장 간 PK 충돌), 발행 id 와 저장 id 가 같아야 ack 가 대조된다 (handle_ack)
            cid = f"cmd-{uuid.uuid4().hex[:12]}"
            msg = RemoteStop(command_id=cid, farm_id=farm_id, scope=req.scope,
                             reason=req.reason, issued_by=req.by, timestamp=now)
            await conn.execute(
                insert(m.command_log).values(
                    command_id=cid, farm_id=farm_id,
                    device_id=device_id, command_type="remote_stop",
                    payload=msg.model_dump(mode="json"), issued_by=req.by, timeout_sec=30,
                )
            )
            outbox.append((topic(farm_id, "edge", device_id, "command"),
                           msg.model_dump_json()))

    # 커밋 이후 발행 — 트랜잭션 안에서 발행하면 롤백 시 엣지만 멈추고 기록이 남지 않는다.
    # 반대 방향(기록만 남고 미발행)은 ack 타임아웃이 실패로 잡아 알림을 낸다
    _publish_outbox(publisher, outbox)
    # 재접속 복구용 retained 상태 — 명령과 달리 브로커에 남아 재부팅한 엣지가 받는다
    _publish_stop_state(publisher, edges, engaged=True, scope=req.scope,
                        reason=req.reason, now=now)

    from middleware.app.alerts import create_alert
    async with engine.begin() as conn:
        for farm_id in farms:
            publisher.publish(farm_id, "stop", _stream_payload(
                "remote", True, scope=req.scope, engaged_at=now.isoformat(),
                by=req.by, reason=req.reason))
            await create_alert(conn, publisher, farm_id=farm_id, severity="warning",
                               alert_kind="stop", title="원격 전체 정지 발동됨",
                               body=f"발동 {req.by or '-'} · 자동 스케줄·원격 제어 차단",
                               deeplink="#control")
    log.warning("remote stop engaged: scope=%s by=%s", req.scope, req.by)
    return {"ok": True, "engaged_at": now.isoformat()}


@router.post("/stop/release")
async def release_remote_stop(req: StopRequest):
    """원격 전체 정지 해제 (FR-35). 해제 권한 수준은 OPN-18 — 현재 API 단은 무검증
    (역할 검사는 앱서버 프록시에서 admin/manager 로 제한)."""
    engine, publisher = _deps()
    now = datetime.now(timezone.utc)
    outbox: list[tuple[str, str]] = []
    async with engine.begin() as conn:
        rel_cond = [
            m.stop_event.c.stop_kind == "remote",
            m.stop_event.c.released_at.is_(None),
            m.stop_event.c.scope == req.scope,
        ]
        if req.scope == "farm":
            # 해제 대상을 해당 농장으로 한정 — 다른 농장의 정지를 잡지 않는다
            rel_cond.append(m.stop_event.c.farm_id == req.farm_id)
        row = (
            await conn.execute(
                update(m.stop_event)
                .where(*rel_cond)
                .values(released_at=now, released_by=req.by)
                .returning(m.stop_event.c.farm_id)
            )
        ).first()
        if row is None:
            raise HTTPException(404, "발동 중인 원격 전체 정지가 없습니다")
        edges = await _edge_devices(conn, row[0])
        farms = [row[0]] if row[0] else await _all_farm_ids(conn)
        for farm_id, device_id in edges:
            # 발동과 같은 규칙 — 엣지마다 개별 id (엣지는 command_id 로 멱등 판정한다)
            cid = f"cmd-{uuid.uuid4().hex[:12]}"
            msg = RemoteStopRelease(command_id=cid, farm_id=farm_id, scope=req.scope,
                                    issued_by=req.by, timestamp=now)
            # 해제도 명령 대장에 남긴다 — 없으면 ack 를 대조할 행이 없어 미도달을 알 수
            # 없다. 엣지 단절 중 해제하면 화면만 풀리고 현장은 멈춘 채로 남는다
            await conn.execute(
                insert(m.command_log).values(
                    command_id=cid, farm_id=farm_id, device_id=device_id,
                    command_type="remote_stop_release",
                    payload=msg.model_dump(mode="json"), issued_by=req.by, timeout_sec=30,
                )
            )
            outbox.append((topic(farm_id, "edge", device_id, "command"),
                           msg.model_dump_json()))

    _publish_outbox(publisher, outbox)  # 커밋 이후 — 해제 실패 시 상태 불일치 방지
    _publish_stop_state(publisher, edges, engaged=False, scope=req.scope, reason=None, now=now)

    from middleware.app.alerts import create_alert
    async with engine.begin() as conn:
        for farm_id in farms:
            publisher.publish(farm_id, "stop", _stream_payload(
                "remote", False, scope=req.scope, released_at=now.isoformat(), by=req.by))
            await create_alert(conn, publisher, farm_id=farm_id, severity="info",
                               alert_kind="stop", title="원격 전체 정지 해제됨",
                               body=f"해제 {req.by or '-'}")
    log.warning("remote stop released: scope=%s by=%s", req.scope, req.by)
    return {"ok": True, "released_at": now.isoformat()}


async def _active_stops(conn, farm_id: str | None) -> dict:
    """활성 정지 상태 — 원격·물리 각각 독립 표시 (동시 성립 가능).

    - **원격 정지는 스코프를 따른다**: farm_id 가 주어지면 전 농장 정지(scope=all)와
      그 농장 정지만. 다른 농장만 멈춘 상태를 이 농장 화면에 표시하면 오해가 된다.
    - **물리 비상정지는 스코프와 무관하게 전부 모은다**: 안전 기능이라 어느 현장에서
      눌렸는지를 모든 화면에서 알아야 한다. 걸린 농장 목록(farm_ids)과 최초 발동
      시각을 함께 준다 — 화면이 농장명과 개수를 문구에 반영한다 (FR-36).
    """
    rows = (
        (await conn.execute(
            select(m.stop_event)
            .where(m.stop_event.c.released_at.is_(None))
            .order_by(m.stop_event.c.engaged_at)
        )).mappings().all()
    )
    out: dict = {"remote": None, "physical_estop": None}
    estop_farms: list[str] = []
    for r in rows:
        if r["stop_kind"] == "physical_estop":
            if r["farm_id"]:
                estop_farms.append(r["farm_id"])
        elif farm_id and not (r["scope"] == "all" or r["farm_id"] == farm_id):
            continue  # 다른 농장의 원격 정지 — 이 스코프에는 표시하지 않는다
        if out[r["stop_kind"]] is not None:
            continue
        out[r["stop_kind"]] = {
            "scope": r["scope"], "engaged_at": r["engaged_at"].isoformat(),
            "by": r["engaged_by"], "reason": r["reason"],
            # 물리 비상정지의 3값 원 보고 — 화면이 "작동됨"과 "확인 필요"를
            # 구분하려면 판정 결과(active)만으로는 부족하다 (§4.7).
            "detail": r["detail"],
        }
    if out["physical_estop"]:
        out["physical_estop"]["farm_ids"] = estop_farms
    return out


@router.get("/stop-state")
async def stop_state_all():
    """전체 스코프 활성 정지 (통합 대시보드 초기 로드) — 응답 형태는 농장별과 같다."""
    engine, _ = _deps()
    async with engine.connect() as conn:
        return await _active_stops(conn, None)


@router.get("/farms/{farm_id}/stop-state")
async def stop_state(farm_id: str):
    """농장 스코프 활성 정지 — 전 농장 정지(scope=all)도 함께 반영한다."""
    engine, _ = _deps()
    async with engine.connect() as conn:
        return await _active_stops(conn, farm_id)


def _estop_reason(msg: EstopState, reason: str | None) -> str:
    """stop_event.reason — 사람이 읽는 한 줄. 기계가 읽을 값은 detail 에 있다."""
    if msg.estop == "unknown":
        return f"상태 확인 불가 ({reason or 'unknown'})"
    return f"현장 장치 ({msg.source})"


# unknown 사유별 화면 문구 — 왜 모르는지가 현장 조치를 가른다.
_ESTOP_UNKNOWN_BODY = {
    "not_read_yet": "엣지가 비상정지 장치를 아직 읽지 못했습니다",
    "read_failed": "비상정지 장치 읽기에 실패했습니다",
    "no_source": "비상정지 상태를 알려줄 장치가 연결돼 있지 않습니다",
}


async def handle_estop_state(conn, msg: EstopState, received_at: datetime,
                             publisher=None) -> None:
    """물리 비상정지 상태 수신 (FR-36, ingest 훅) — 표시 전용.

    `estop` 은 3값이며 **`unknown` 도 `engaged` 와 같이 정지로 판정한다**
    (§4.7). 판정 자체는 `msg.is_engaged` 한 곳에 있고, 여기서는 화면 문구만
    갈린다.
    """
    # `estop` 이 아예 없으면 값이 없는 것이지 풀린 것이 아니다. 판정은 스키마
    # 기본값이 이미 안전측이고, 여기서는 왜 모르는지만 남긴다 — 현장 확인과
    # 발행자 점검은 다른 조치다.
    reason = msg.reason
    if msg.estop == "unknown" and reason is None:
        reason = "no_report" if "estop" not in msg.model_fields_set else "unspecified"
    detail = {"estop": msg.estop, "reason": reason, "source": msg.source}
    unknown = msg.estop == "unknown"

    if msg.is_engaged:
        exists = (
            await conn.execute(
                select(m.stop_event.c.id, m.stop_event.c.detail).where(
                    m.stop_event.c.stop_kind == "physical_estop",
                    m.stop_event.c.released_at.is_(None),
                    m.stop_event.c.farm_id == msg.farm_id,
                ).limit(1)
            )
        ).first()
        if exists:
            if (exists[1] or {}) == detail:
                return
            # 같은 정지가 이어지되 보고가 달라졌다 (unknown → engaged 확정, 또는
            # 사유만 변경). 사유도 화면 문구를 바꾸므로 함께 갱신한다.
            await conn.execute(
                update(m.stop_event)
                .where(m.stop_event.c.id == exists[0])
                .values(detail=detail, reason=_estop_reason(msg, reason))
            )
        else:
            await conn.execute(
                insert(m.stop_event).values(
                    stop_kind="physical_estop", scope="farm", farm_id=msg.farm_id,
                    engaged_at=msg.timestamp, reason=_estop_reason(msg, reason), detail=detail,
                )
            )
        if publisher:
            publisher.publish(msg.farm_id, "stop", _stream_payload(
                "physical_estop", True, scope="farm", reason=_estop_reason(msg, reason),
                engaged_at=msg.timestamp.isoformat(), detail=detail))
        from middleware.app.alerts import create_alert
        await create_alert(
            conn, publisher, farm_id=msg.farm_id, severity="warning", alert_kind="stop",
            title="현장 비상정지 상태 확인 필요" if unknown else "현장 비상정지 작동됨",
            body=(
                _ESTOP_UNKNOWN_BODY.get(reason, "비상정지 상태를 확인할 수 없습니다")
                + " — 안전을 위해 눌린 것으로 간주합니다. 현장 확인이 필요합니다."
            ) if unknown else "현장에서 직접 해제해야 합니다 (웹 해제 불가)",
            # 값과 발동 시각으로 나눈다. 값 — "확인 불가" 뒤에 실제로 눌린 게 확인되면
            # 새 알림이다. 시각 — 농장 단위로만 잡으면(estop:{farm_id}) 확인하지 않은
            # 알림 하나가 그 농장의 이후 모든 비상정지 알림을 영구히 막는다 (create_alert
            # 의 중복 억제는 '미확인' 기준이고, 해제해도 그 알림이 사라지지 않는다).
            # 값만으로는 해제 뒤 재발동이 같은 키라 막히므로 둘 다 필요하다.
            # 재전달(retain 된 estop_state 재수신)은 위의 detail 비교에서 이미 걸러진다.
            dedup_key=f"estop:{msg.farm_id}:{msg.estop}:{msg.timestamp.isoformat()}",
        )
        log.warning("physical estop %s: %s (reason=%s)", msg.estop, msg.farm_id, msg.reason)
    else:
        row = (
            await conn.execute(
                update(m.stop_event)
                .where(m.stop_event.c.stop_kind == "physical_estop",
                       m.stop_event.c.released_at.is_(None),
                       m.stop_event.c.farm_id == msg.farm_id)
                .values(released_at=msg.timestamp, detail=detail)
                .returning(m.stop_event.c.id)
            )
        ).first()
        if row is None:
            return   # 열린 비상정지가 없음 — 재전달이거나 이미 해제된 상태
        if publisher:
            publisher.publish(msg.farm_id, "stop", _stream_payload(
                "physical_estop", False, scope="farm",
                released_at=msg.timestamp.isoformat(), detail=detail))
        # 해제도 알림으로 남긴다 — 원격 정지와 동작을 맞춘다(발동 1건·해제 1건).
        # 없으면 벨에 「작동됨」만 쌓여, 지금 걸려 있는 것인지 지난 일인지 알 수 없다.
        from middleware.app.alerts import create_alert
        await create_alert(conn, publisher, farm_id=msg.farm_id, severity="info",
                           alert_kind="stop", title="현장 비상정지 해제됨",
                           body="현장에서 직접 해제했습니다",
                           dedup_key=f"estop-release:{msg.farm_id}:{msg.timestamp.isoformat()}")
        log.warning("physical estop released (현장 조작 확인): %s", msg.farm_id)
