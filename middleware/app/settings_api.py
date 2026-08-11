"""설정(팜·설비 관리) 내부 REST — 애플리케이션 서버 전용 (외부 공개 없음).

HMI 설정 화면이 사용하는 CRUD:
- 발견(discovery): 미등록이지만 데이터가 들어오는 팜을 목록화 → 팜+장치+센서 일괄 등록
- 팜 수정/삭제(소프트)
- 장치(device_meta) + 상세(sensor/tank/work_station/actuator) 추가/수정/삭제(소프트)

기존 internal_api.upsert_farm 의 insert(...).on_conflict_do_update / soft-delete 규약을 따른다.
device_meta 와 상세 테이블은 seed.py 의 2단계(device_meta.id 확보 → 상세 FK)를 한 트랜잭션으로 수행.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func as sa_func, select, update
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.weather import collect_farm_weather, validate_coordinates
from shared.schemas.topics import STREAMS, internal_topic, topic

log = logging.getLogger("mw.settings")

router = APIRouter(prefix="/internal")

FARM_TYPES = ("greenhouse", "plant_factory", "open_field")
DEVICE_TYPES = ("robot", "growbed", "tank", "station", "sensor", "edge", "actuator")


def _engine():
    from middleware.app.main import engine  # 순환 import 회피 (런타임 참조)

    return engine


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── 스키마 ────────────────────────────────────────────────────

class FarmUpdate(BaseModel):
    name: str | None = None
    farm_type: str | None = None
    crop: str | None = None
    region_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    accuracy_m: float | None = None


class DeviceUpsert(BaseModel):
    device_id: str
    device_type: str
    name: str
    model: str | None = None
    location: str | None = None
    registered_by: str | None = None
    # sensor 상세
    sensor_type: str | None = None
    unit: str | None = None
    parent_device_id: str | None = None
    # tank 상세
    tank_type: str | None = None
    capacity_l: float | None = None
    consumption_rate: float | None = None
    consumption_unit: str | None = None
    # station 상세
    station_type: str | None = None
    # actuator 상세
    command: str | None = None
    affects_sensor_id: str | None = None
    power_kw: float | None = None


class DevicePatch(BaseModel):
    name: str | None = None
    model: str | None = None
    location: str | None = None
    updated_by: str | None = None
    # 상세(있으면 갱신)
    sensor_type: str | None = None
    unit: str | None = None
    parent_device_id: str | None = None
    tank_type: str | None = None
    capacity_l: float | None = None
    consumption_rate: float | None = None
    consumption_unit: str | None = None
    station_type: str | None = None
    command: str | None = None
    affects_sensor_id: str | None = None
    power_kw: float | None = None


class DiscoveryRegister(BaseModel):
    name: str
    farm_type: str = "greenhouse"
    crop: str | None = None
    region_code: str
    latitude: float
    longitude: float
    accuracy_m: float | None = None


# ── 헬퍼 ──────────────────────────────────────────────────────

async def _require_farm(conn, farm_id: str) -> None:
    exists = (
        await conn.execute(select(m.farm.c.farm_id).where(m.farm.c.farm_id == farm_id))
    ).first()
    if exists is None:
        raise HTTPException(404, f"unknown farm: {farm_id}")


async def _create_device(conn, farm_id: str, d: DeviceUpsert) -> int:
    """device_meta + 상세 테이블 1행을 한 트랜잭션에 생성. device_meta.id 반환."""
    if d.device_type not in DEVICE_TYPES:
        raise HTTPException(400, f"허용되지 않는 device_type: {d.device_type}")
    res = await conn.execute(
        insert(m.device_meta)
        .values(
            farm_id=farm_id, device_id=d.device_id, device_type=d.device_type,
            name=d.name, model=d.model, location=d.location, registered_by=d.registered_by,
        )
        # 내렸던 장치를 다시 등록하면 되살린다. do_nothing 이면 deleted_at 이 남아
        # 등록은 성공했는데 화면에는 안 나오는 상태가 된다 — 되돌릴 길이 없어진다.
        .on_conflict_do_update(
            constraint="uq_device_meta_farm_device",
            set_={"device_type": d.device_type, "name": d.name, "model": d.model,
                  "location": d.location, "deleted_at": None},
        )
        .returning(m.device_meta.c.id)
    )
    row = res.first()
    if row is None:  # 방어적 — 위 upsert 는 항상 행을 돌려준다
        row = (
            await conn.execute(
                select(m.device_meta.c.id).where(
                    m.device_meta.c.farm_id == farm_id, m.device_meta.c.device_id == d.device_id
                )
            )
        ).first()
    device_meta_id = row.id

    if d.device_type == "sensor":
        if not d.sensor_type or not d.unit:
            raise HTTPException(400, "sensor 는 sensor_type·unit 이 필요합니다")
        await conn.execute(
            insert(m.sensor)
            .values(
                device_meta_id=device_meta_id, farm_id=farm_id, sensor_id=d.device_id,
                parent_device_id=d.parent_device_id, sensor_type=d.sensor_type,
                unit=d.unit, location=d.location,
            )
            .on_conflict_do_nothing(constraint="uq_sensor_farm_sensor")
        )
    elif d.device_type == "tank":
        if not d.tank_type or d.capacity_l is None:
            raise HTTPException(400, "tank 는 tank_type·capacity_l 이 필요합니다")
        await conn.execute(
            insert(m.tank)
            .values(
                device_meta_id=device_meta_id, farm_id=farm_id, tank_type=d.tank_type,
                capacity_l=d.capacity_l, consumption_rate=d.consumption_rate,
                consumption_unit=d.consumption_unit,
            )
            .on_conflict_do_nothing()
        )
    elif d.device_type == "station":
        if not d.station_type:
            raise HTTPException(400, "station 은 station_type 이 필요합니다")
        await conn.execute(
            insert(m.work_station)
            .values(farm_id=farm_id, station_id=d.device_id, station_type=d.station_type)
            .on_conflict_do_nothing(constraint="uq_work_station_farm_station")
        )
    elif d.device_type == "actuator":
        if not d.command:
            raise HTTPException(400, "actuator 는 command 가 필요합니다")
        await conn.execute(
            insert(m.actuator)
            .values(
                device_meta_id=device_meta_id, farm_id=farm_id, actuator_id=d.device_id,
                command=d.command, affects_sensor_id=d.affects_sensor_id,
                power_kw=d.power_kw, location=d.location,
            )
            .on_conflict_do_nothing(constraint="uq_actuator_farm_actuator")
        )
    return device_meta_id


# ── 팜 수정/삭제 ──────────────────────────────────────────────

@router.put("/farms/{farm_id}")
async def update_farm(farm_id: str, req: FarmUpdate, background_tasks: BackgroundTasks):
    """팜 메타데이터 수정 — farm_id(자연키·MQTT 토픽)는 불변."""
    if req.farm_type is not None and req.farm_type not in FARM_TYPES:
        raise HTTPException(400, f"허용되지 않는 farm_type: {req.farm_type}")
    if (req.latitude is None) != (req.longitude is None):
        raise HTTPException(400, "latitude와 longitude는 함께 전달해야 합니다")
    patch = {
        k: v
        for k, v in req.model_dump(exclude={"region_code", "latitude", "longitude", "accuracy_m"}).items()
        if v is not None
    }
    location_values = (req.region_code, req.latitude, req.longitude)
    if any(value is not None for value in location_values):
        if not all(value is not None for value in location_values):
            raise HTTPException(400, "region_code, latitude, longitude는 함께 전달해야 합니다")
        if not (len(req.region_code) == 10 and req.region_code.isdigit()):
            raise HTTPException(400, "region_code는 10자리 행정구역코드여야 합니다")
        try:
            validate_coordinates(req.latitude, req.longitude)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        patch["latitude"] = req.latitude
        patch["longitude"] = req.longitude
        patch["region_code"] = req.region_code
    if not patch:
        raise HTTPException(400, "수정할 필드가 없습니다")
    patch["updated_at"] = _now()
    async with _engine().begin() as conn:
        await _require_farm(conn, farm_id)
        await conn.execute(update(m.farm).where(m.farm.c.farm_id == farm_id).values(**patch))
    if "latitude" in patch and "longitude" in patch:
        background_tasks.add_task(
            collect_farm_weather, _engine(), farm_id, patch["region_code"],
            patch["latitude"], patch["longitude"]
        )
    return {"ok": True, "farm_id": farm_id}


@router.delete("/farms/{farm_id}")
async def deactivate_farm(farm_id: str):
    """팜 소프트 삭제 — is_active=false (GET /internal/farms 가 is_active 필터)."""
    async with _engine().begin() as conn:
        await _require_farm(conn, farm_id)
        await conn.execute(
            update(m.farm).where(m.farm.c.farm_id == farm_id).values(is_active=False, updated_at=_now())
        )
        devices = await _farm_devices(conn, farm_id)
    return {"ok": True, "farm_id": farm_id,
            "retained_clear_queued": _clear_retained(farm_id, devices)}


async def _farm_devices(conn, farm_id: str) -> list[tuple[str, str]]:
    """retained 를 남겼을 수 있는 장치 전부 — 두 표를 합쳐야 빠지지 않는다.

    device_connection_state 는 birth·하트비트를 한 번이라도 보낸 장치만,
    device_meta 는 사람이 등록한 장치만 담는다. 어느 한쪽에만 있는 장치가 있다.
    소프트 삭제된 장치도 포함한다 — 지워진 장치일수록 retained 가 남으면 곤란하다.
    """
    dcs = m.device_connection_state
    meta = m.device_meta
    rows = (
        await conn.execute(
            select(dcs.c.device_id, dcs.c.device_type).where(dcs.c.farm_id == farm_id)
            .union(
                select(meta.c.device_id, meta.c.device_type).where(meta.c.farm_id == farm_id)
            )
        )
    ).all()
    return [(r[0], r[1]) for r in rows]


# retained 는 아무도 걷어가지 않는다 — 농장을 접어도 브로커에 남아 구독자가 붙을
# 때마다 없는 농장이 되살아난다. 빈 payload + retain 이 삭제 신호다.
# MESSAGE_TYPES 전체가 아니라 retained 로 발행되는 것만이다 (command·ack·
# heartbeat 은 retain 하지 않는다).
_RETAINED_TYPES = ("birth", "death", "telemetry", "status", "layout", "stop_state")


def _clear_retained(farm_id: str, devices) -> int:
    """삭제 신호를 발행 큐에 넣고 그 건수를 돌려준다 — 발행 완료가 아니다.

    publish_raw 는 큐에 적재만 하고 실제 발행은 재발행기가 맡는다. 큐가 가득
    차면 오래된 것부터 버려지므로 이 수만큼 실제로 지워졌다고 볼 수 없다.
    농장을 접는 일은 실시간성이 필요 없고 실패해도 다시 부르면 되므로, 여기서는
    「몇 건을 줄 세웠나」 까지만 책임진다 (응답 필드 이름도 그래서 queued).

    엣지가 아직 살아 있으면 지운 자리를 곧바로 다시 채운다. 이 청소는 농장을
    접는 것과 엣지를 내리는 것이 함께 이뤄질 때만 실효가 있다.
    """
    from middleware.app.main import publisher

    count = 0
    try:
        for device_id, device_type in devices:
            for message_type in _RETAINED_TYPES:
                publisher.publish_raw(
                    topic(farm_id, device_type, device_id, message_type), "", retain=True
                )
                count += 1
        for stream in STREAMS:
            publisher.publish_raw(internal_topic(farm_id, stream), "", retain=True)
            count += 1
    except Exception:
        # 비활성화는 이미 커밋됐다 — 청소 실패로 요청 전체를 500 으로 접지 않는다.
        # 다시 호출하면 남은 것부터 이어서 지운다 (빈 retained 발행은 멱등).
        log.exception("retained 청소 실패: %s (%d 건 적재 후 중단)", farm_id, count)
    return count


# ── 장치(device_meta) + 상세 CRUD ─────────────────────────────

async def _unregistered_devices(conn, farm_id: str) -> list[dict]:
    """데이터는 들어오는데 device_meta 행이 없는 장치 — 화면의 유령 목록.

    이 목록이 필요한 이유: 로봇·통신 목록은 이력 표에서 나오므로 등록 절차를
    거치지 않은 장치도 화면에 뜬다. 그런데 설정 화면은 device_meta 만 보여 줘서,
    정작 지우고 싶은 쪽에는 누를 버튼이 없었다.

    대장에서 내린 장치도 여기로 돌아온다 — 계속 발행한다면 그 장치는 여전히
    거기 있다. 잘못 내렸다면 다시 등록하면 된다.
    """
    known = {
        r.device_id
        for r in (
            await conn.execute(
                select(m.device_meta.c.device_id).where(
                    m.device_meta.c.farm_id == farm_id,
                    m.device_meta.c.deleted_at.is_(None),
                )
            )
        ).all()
    }
    # 마지막으로 소식이 있던 때를 함께 싣는다. 이 칸에는 지금 돌고 있는 장치와
    # 오래전에 사라진 장치가 같이 모이는데, 그 둘은 할 일이 다르다.
    seen: dict[str, tuple[str | None, object]] = {}
    for r in (
        await conn.execute(
            select(m.device_connection_state.c.device_id, m.device_connection_state.c.device_type,
                   m.device_connection_state.c.last_received_at)
            .where(m.device_connection_state.c.farm_id == farm_id)
        )
    ).all():
        seen[r.device_id] = (r.device_type, r.last_received_at)
    for r in (
        await conn.execute(
            select(m.robot_status.c.device_id, sa_func.max(m.robot_status.c.ts).label("last_ts"))
            .where(m.robot_status.c.farm_id == farm_id)
            .group_by(m.robot_status.c.device_id)
        )
    ).all():
        dtype, last = seen.get(r.device_id, ("robot", None))
        if last is None or (r.last_ts and r.last_ts > last):
            last = r.last_ts
        seen[r.device_id] = (dtype or "robot", last)
    rows = [
        {"device_id": did, "device_type": dtype if dtype in DEVICE_TYPES else "edge",
         "name": did, "model": None, "location": None, "detail": None, "registered": False,
         "last_seen": last.isoformat() if last else None}
        for did, (dtype, last) in seen.items()
        if did not in known
    ]
    # 최근 것이 위로 — 지금 발행 중인 장치가 옛 흔적에 묻히면 안 된다.
    rows.sort(key=lambda r: (r["last_seen"] or ""), reverse=True)
    return rows


@router.get("/farms/{farm_id}/devices")
async def list_devices(farm_id: str, include_unregistered: bool = False):
    """미삭제 장치 + 상세(sensor/tank/actuator/station) 목록.

    include_unregistered 는 설정 화면 전용이다. 미등록 장치를 기본으로 끼워 넣으면
    이 목록을 설비 대장으로 쓰는 화면(상태 페이지의 종류별 집계)에 정체 불명의
    장치가 섞여 든다 — 지우는 화면에서만 보이면 된다.
    """
    async with _engine().connect() as conn:
        await _require_farm(conn, farm_id)
        unregistered = await _unregistered_devices(conn, farm_id) if include_unregistered else []
        devices = (
            await conn.execute(
                select(m.device_meta)
                .where(m.device_meta.c.farm_id == farm_id, m.device_meta.c.deleted_at.is_(None))
                .order_by(m.device_meta.c.device_type, m.device_meta.c.device_id)
            )
        ).mappings().all()
        sensors = {
            s["device_meta_id"]: s
            for s in (
                await conn.execute(select(m.sensor).where(m.sensor.c.farm_id == farm_id))
            ).mappings().all()
        }
        tanks = {
            t["device_meta_id"]: t
            for t in (
                await conn.execute(select(m.tank).where(m.tank.c.farm_id == farm_id))
            ).mappings().all()
        }
        actuators = {
            a["device_meta_id"]: a
            for a in (
                await conn.execute(select(m.actuator).where(m.actuator.c.farm_id == farm_id))
            ).mappings().all()
        }
        stations = {
            w["station_id"]: w
            for w in (
                await conn.execute(
                    select(m.work_station).where(m.work_station.c.farm_id == farm_id)
                )
            ).mappings().all()
        }

    out = []
    for d in devices:
        detail = None
        if d["device_type"] == "sensor" and d["id"] in sensors:
            s = sensors[d["id"]]
            detail = {"sensor_type": s["sensor_type"], "unit": s["unit"],
                      "parent_device_id": s["parent_device_id"], "last_value": s["last_value"]}
        elif d["device_type"] == "tank" and d["id"] in tanks:
            t = tanks[d["id"]]
            detail = {"tank_type": t["tank_type"], "capacity_l": t["capacity_l"],
                      "consumption_rate": t["consumption_rate"], "consumption_unit": t["consumption_unit"]}
        elif d["device_type"] == "actuator" and d["id"] in actuators:
            a = actuators[d["id"]]
            detail = {"command": a["command"], "affects_sensor_id": a["affects_sensor_id"],
                      "power_kw": a["power_kw"]}
        elif d["device_type"] == "station" and d["device_id"] in stations:
            detail = {"station_type": stations[d["device_id"]]["station_type"]}
        out.append({
            "device_id": d["device_id"], "device_type": d["device_type"], "name": d["name"],
            "model": d["model"], "location": d["location"], "detail": detail,
            "registered": True,
        })
    return out + unregistered


@router.post("/farms/{farm_id}/devices")
async def create_device(farm_id: str, req: DeviceUpsert):
    async with _engine().begin() as conn:
        await _require_farm(conn, farm_id)
        await _create_device(conn, farm_id, req)
    return {"ok": True, "farm_id": farm_id, "device_id": req.device_id}


@router.put("/farms/{farm_id}/devices/{device_id}")
async def patch_device(farm_id: str, device_id: str, req: DevicePatch):
    async with _engine().begin() as conn:
        row = (
            await conn.execute(
                select(m.device_meta.c.id, m.device_meta.c.device_type).where(
                    m.device_meta.c.farm_id == farm_id,
                    m.device_meta.c.device_id == device_id,
                    m.device_meta.c.deleted_at.is_(None),
                )
            )
        ).first()
        if row is None:
            raise HTTPException(404, f"unknown device: {device_id}")
        meta_patch = {
            k: v for k, v in {"name": req.name, "model": req.model, "location": req.location}.items()
            if v is not None
        }
        if meta_patch:
            meta_patch["updated_at"] = _now()
            await conn.execute(
                update(m.device_meta).where(m.device_meta.c.id == row.id).values(**meta_patch)
            )
        # 상세 갱신
        if row.device_type == "sensor":
            sp = {k: v for k, v in {"sensor_type": req.sensor_type, "unit": req.unit,
                                    "parent_device_id": req.parent_device_id,
                                    "location": req.location}.items() if v is not None}
            if sp:
                sp["updated_at"] = _now()
                await conn.execute(update(m.sensor).where(m.sensor.c.device_meta_id == row.id).values(**sp))
        elif row.device_type == "tank":
            tp = {k: v for k, v in {"tank_type": req.tank_type, "capacity_l": req.capacity_l,
                                    "consumption_rate": req.consumption_rate,
                                    "consumption_unit": req.consumption_unit}.items() if v is not None}
            if tp:
                await conn.execute(update(m.tank).where(m.tank.c.device_meta_id == row.id).values(**tp))
        elif row.device_type == "actuator":
            ap = {k: v for k, v in {"command": req.command, "affects_sensor_id": req.affects_sensor_id,
                                    "power_kw": req.power_kw, "location": req.location}.items() if v is not None}
            if ap:
                ap["updated_at"] = _now()
                await conn.execute(update(m.actuator).where(m.actuator.c.device_meta_id == row.id).values(**ap))
        elif row.device_type == "station" and req.station_type is not None:
            await conn.execute(
                update(m.work_station)
                .where(m.work_station.c.farm_id == farm_id, m.work_station.c.station_id == device_id)
                .values(station_type=req.station_type)
            )
    return {"ok": True, "farm_id": farm_id, "device_id": device_id}


@router.delete("/farms/{farm_id}/devices/{device_id}")
async def delete_device(farm_id: str, device_id: str):
    """장치를 대장에서 내린다 — device_meta.deleted_at (상세 행은 유지).

    지우는 것이 아니라 「이 농장의 장비가 아니다」로 되돌리는 것이다. 계속
    발행하는 장치라면 설정 화면의 「미등록」 칸에 다시 나타나고, 거기서 다시
    등록할 수 있다. 등록되지 않은 장치는 애초에 목록에 없으므로 지울 것도 없다.

    이력은 지우지 않는다. 실제로 들어온 값이고, 지나간 기간의 통계가 조용히
    바뀌면 안 된다.
    """
    async with _engine().begin() as conn:
        res = await conn.execute(
            update(m.device_meta)
            .where(
                m.device_meta.c.farm_id == farm_id,
                m.device_meta.c.device_id == device_id,
                m.device_meta.c.deleted_at.is_(None),
            )
            .values(deleted_at=_now(), updated_at=_now())
        )
        if res.rowcount == 0:
            raise HTTPException(404, f"unknown device: {device_id}")
    return {"ok": True, "farm_id": farm_id, "device_id": device_id}


# ── 발견(discovery) ───────────────────────────────────────────

@router.get("/discovery")
async def list_discovery():
    """미들웨어에 미등록이지만 데이터가 들어오는 팜 목록 (설정 화면 '발견' 소스).

    **활성** farm_id 만 제외한다 — 소프트 삭제(is_active=false)된 팜이 계속 발행하면
    다시 발견 목록에 떠 재등록(재활성화)할 수 있다.
    """
    async with _engine().connect() as conn:
        farm_rows = (await conn.execute(select(m.farm))).mappings().all()
        registered = {r["farm_id"] for r in farm_rows if r["is_active"]}
        existing = {r["farm_id"]: r for r in farm_rows}
        rows = (
            await conn.execute(
                select(m.pending_registration).order_by(
                    m.pending_registration.c.farm_id, m.pending_registration.c.device_id
                )
            )
        ).mappings().all()

    by_farm: dict[str, dict] = {}
    for r in rows:
        if r["farm_id"] in registered:
            continue
        f = by_farm.setdefault(r["farm_id"], {"farm_id": r["farm_id"], "devices": [],
                                              "first_seen": r["first_seen"], "last_seen": r["last_seen"]})
        f["devices"].append({
            "device_id": r["device_id"], "device_type": r["device_type"],
            "sensors": r["sensors"], "msg_count": r["msg_count"],
            "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
        })
        f["first_seen"] = min(f["first_seen"], r["first_seen"])
        f["last_seen"] = max(f["last_seen"], r["last_seen"])
    return [
        {
            "farm_id": f["farm_id"],
            "name": existing.get(f["farm_id"], {}).get("name"),
            "farm_type": existing.get(f["farm_id"], {}).get("farm_type"),
            "crop": existing.get(f["farm_id"], {}).get("crop"),
            "region_code": existing.get(f["farm_id"], {}).get("region_code"),
            "latitude": existing.get(f["farm_id"], {}).get("latitude"),
            "longitude": existing.get(f["farm_id"], {}).get("longitude"),
            "device_count": len(f["devices"]),
            "sensor_count": sum(len(d["sensors"]) for d in f["devices"]),
            "first_seen": f["first_seen"].isoformat() if f["first_seen"] else None,
            "last_seen": f["last_seen"].isoformat() if f["last_seen"] else None,
            "devices": f["devices"],
        }
        for f in by_farm.values()
    ]


@router.post("/discovery/{farm_id}/register")
async def register_discovered(
    farm_id: str, req: DiscoveryRegister, background_tasks: BackgroundTasks,
):
    """발견된 팜을 등록 — farm + 발견 장치 + (birth/telemetry 로 파악한) 센서를 한 번에 생성.

    한 트랜잭션: farm upsert → pending 장치마다 device_meta,
    발견 센서마다 별도 device_meta(type=sensor)+sensor 행(parent=발견 장치) → pending 삭제.
    """
    if req.farm_type not in FARM_TYPES:
        raise HTTPException(400, f"허용되지 않는 farm_type: {req.farm_type}")
    if not (len(req.region_code) == 10 and req.region_code.isdigit()):
        raise HTTPException(400, "region_code must be a 10-digit administrative code")
    try:
        validate_coordinates(req.latitude, req.longitude)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    async with _engine().begin() as conn:
        pend = (
            await conn.execute(
                select(m.pending_registration).where(m.pending_registration.c.farm_id == farm_id)
            )
        ).mappings().all()
        if not pend:
            raise HTTPException(404, f"발견된 팜이 아닙니다: {farm_id}")

        await conn.execute(
            insert(m.farm)
            .values(
                farm_id=farm_id, name=req.name, farm_type=req.farm_type, crop=req.crop,
                region_code=req.region_code, latitude=req.latitude, longitude=req.longitude,
            )
            .on_conflict_do_update(
                index_elements=["farm_id"],
                # 소프트 삭제된 팜을 발견으로 재등록하면 재활성화한다.
                set_={
                    "name": req.name, "farm_type": req.farm_type, "crop": req.crop,
                    "region_code": req.region_code, "latitude": req.latitude,
                    "longitude": req.longitude, "is_active": True,
                },
            )
        )

        devices = 0
        sensors = 0
        for p in pend:
            dtype = p["device_type"] or "growbed"
            await _create_device(
                conn, farm_id,
                DeviceUpsert(device_id=p["device_id"], device_type=dtype,
                             name=p["device_id"], registered_by="discovery"),
            )
            devices += 1
            for s in (p["sensors"] or []):
                await _create_device(
                    conn, farm_id,
                    DeviceUpsert(device_id=s["sensor_id"], device_type="sensor",
                                 name=s["sensor_id"], sensor_type=s["sensor_type"],
                                 unit=s["unit"], parent_device_id=p["device_id"],
                                 registered_by="discovery"),
                )
                sensors += 1

        await conn.execute(
            delete(m.pending_registration).where(m.pending_registration.c.farm_id == farm_id)
        )
    background_tasks.add_task(
        collect_farm_weather, _engine(), farm_id, req.region_code, req.latitude, req.longitude,
    )
    return {"ok": True, "farm_id": farm_id, "devices": devices, "sensors": sensors}
