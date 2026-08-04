"""내부 조회 REST — 애플리케이션 서버 전용 (외부 공개 없음, communication-interface.md §7).

실시간은 내부 MQTT 재발행으로 흐르고, 여기는 초기 로드·이력 조회를 담당한다.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.weather import make_region_code

router = APIRouter(prefix="/internal")


class FarmUpsert(BaseModel):
    farm_id: str
    name: str
    farm_type: str = "greenhouse"
    crop: str | None = None
    # 위치는 region_code 계산에만 사용하며 DB에는 저장하지 않는다.
    latitude: float | None = None
    longitude: float | None = None
    accuracy_m: float | None = None


@router.post("/farms")
async def upsert_farm(req: FarmUpsert):
    """농장 등록 (멱등 upsert) — FR-38 다농장의 초석.

    가상 엣지 연동 테스트가 둘째 농장을 붙일 때 사용한다. 미등록 농장의
    birth 는 FK 로 거부되므로, 데이터 수신 전에 반드시 등록해야 한다.
    """
    if req.farm_type not in ("greenhouse", "plant_factory", "open_field"):
        raise HTTPException(400, f"허용되지 않는 farm_type: {req.farm_type}")
    if (req.latitude is None) != (req.longitude is None):
        raise HTTPException(400, "latitude와 longitude는 함께 전달해야 합니다")
    try:
        region_code = make_region_code(req.latitude, req.longitude) if req.latitude is not None and req.longitude is not None else None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    async with _engine().begin() as conn:
        await conn.execute(
            insert(m.farm)
            .values(farm_id=req.farm_id, name=req.name,
                    farm_type=req.farm_type, crop=req.crop, region_code=region_code)
            .on_conflict_do_update(
                index_elements=["farm_id"],
                # 소프트 삭제된 팜을 재등록하면 재활성화한다.
                set_={"name": req.name, "farm_type": req.farm_type, "crop": req.crop, "region_code": region_code, "is_active": True},
            )
        )
    return {"ok": True, "farm_id": req.farm_id}


def _engine():
    from middleware.app.main import engine  # 순환 import 회피 (런타임 참조)
    return engine


@router.get("/farms")
async def list_farms():
    async with _engine().connect() as conn:
        farms = (
            (await conn.execute(select(m.farm).where(m.farm.c.is_active))).mappings().all()
        )
        conns = (
            (await conn.execute(select(m.device_connection_state))).mappings().all()
        )
    by_farm: dict[str, list] = {}
    for c in conns:
        by_farm.setdefault(c["farm_id"], []).append(c["state"])
    return [
        {
            "farm_id": f["farm_id"], "name": f["name"], "farm_type": f["farm_type"],
            "crop": f["crop"],
            "devices_total": len(by_farm.get(f["farm_id"], [])),
            "devices_online": by_farm.get(f["farm_id"], []).count("online"),
        }
        for f in farms
    ]


@router.get("/farms/{farm_id}/snapshot")
async def farm_snapshot(farm_id: str):
    """대시보드 초기 로드용 스냅샷 — 센서 최신값·로봇 최신 상태·통신 상태."""
    async with _engine().connect() as conn:
        farm = (
            (await conn.execute(select(m.farm).where(m.farm.c.farm_id == farm_id)))
            .mappings().first()
        )
        if farm is None:
            raise HTTPException(404, f"unknown farm: {farm_id}")

        sensors = (
            (await conn.execute(
                select(m.sensor).where(m.sensor.c.farm_id == farm_id)
                .order_by(m.sensor.c.sensor_id)
            )).mappings().all()
        )
        robots = (
            (await conn.execute(text(
                "SELECT DISTINCT ON (device_id) device_id, ts, pos_x, pos_y, speed, "
                "battery_pct, charging, mission_state "
                "FROM mw.robot_status WHERE farm_id = :farm ORDER BY device_id, ts DESC"
            ), {"farm": farm_id})).mappings().all()
        )
        connections = (
            (await conn.execute(
                select(m.device_connection_state)
                .where(m.device_connection_state.c.farm_id == farm_id)
            )).mappings().all()
        )
        # 탱크·워크스테이션·랙 — 작업·공급 화면과 농장 카드 게이지 (FR-08·21~26 표시)
        tanks = (
            (await conn.execute(
                select(m.tank, m.device_meta.c.device_id, m.device_meta.c.name)
                .join(m.device_meta, m.tank.c.device_meta_id == m.device_meta.c.id)
                .where(m.tank.c.farm_id == farm_id)
                .order_by(m.tank.c.tank_type)
            )).mappings().all()
        )
        stations = (
            (await conn.execute(
                select(m.work_station).where(m.work_station.c.farm_id == farm_id)
                .order_by(m.work_station.c.station_id)
            )).mappings().all()
        )
        rack = (
            await conn.execute(text(
                "SELECT (SELECT count(*) FROM mw.rack_slot WHERE farm_id = :farm) AS slots, "
                "(SELECT count(*) FROM mw.pallet WHERE farm_id = :farm) AS pallets, "
                "(SELECT count(*) FROM mw.pallet WHERE farm_id = :farm AND state='stored') AS stored, "
                "(SELECT count(*) FROM mw.pallet WHERE farm_id = :farm AND state='moving') AS moving, "
                "(SELECT count(*) FROM mw.pallet WHERE farm_id = :farm AND state='at_station') AS at_station"
            ), {"farm": farm_id})
        ).mappings().first()

    # 탱크 잔량 환산 — 용량·소비율로 "약 NL · N일분" (FR-08 비고)
    #
    # 수위 센서와 탱크의 연결: 규약상 센서 id 가 `tank-{tank_type}-lv` 다
    # (virtual-edge config·시드가 이 규약을 공유). 장비 등록 화면에서 임의 이름의
    # 수위 센서를 만들 수 있으므로, 매칭 실패는 정상 경로로 두고 정적 수위로 폴백한다.
    level_by_type = {
        s["sensor_id"].removeprefix("tank-").removesuffix("-lv"): s["last_value"]
        for s in sensors
        if s["sensor_type"] == "water_level" and s["sensor_id"].startswith("tank-")
    }
    tank_out = []
    for t in tanks:
        pct = level_by_type.get(t["tank_type"], t["current_level_pct"])
        remain_l = round(t["capacity_l"] * (pct or 0) / 100, 1) if pct is not None else None
        rate = t["consumption_rate"]
        if remain_l is not None and rate:
            per_day = rate if t["consumption_unit"] == "per_day" else None
            days = round(remain_l / per_day, 1) if per_day else None
            uses = round(remain_l / rate) if t["consumption_unit"] == "per_task" else None
        else:
            days = uses = None
        tank_out.append({
            "device_id": t["device_id"], "name": t["name"], "tank_type": t["tank_type"],
            "capacity_l": t["capacity_l"], "level_pct": pct, "remain_l": remain_l,
            "days_left": days, "uses_left": uses,
        })

    return {
        "farm": {"farm_id": farm["farm_id"], "name": farm["name"],
                 "farm_type": farm["farm_type"], "crop": farm["crop"]},
        "sensors": [
            {"sensor_id": s["sensor_id"], "sensor_type": s["sensor_type"], "unit": s["unit"],
             "location": s["location"], "value": s["last_value"],
             "ts": s["last_ts"].isoformat() if s["last_ts"] else None,
             "sensor_state": s["sensor_state"]}
            for s in sensors
        ],
        "robots": [
            {"device_id": r["device_id"], "ts": r["ts"].isoformat(),
             "pos_x": r["pos_x"], "pos_y": r["pos_y"], "speed": r["speed"],
             "battery_pct": r["battery_pct"], "charging": r["charging"],
             "mission_state": r["mission_state"]}
            for r in robots
        ],
        "connections": [
            {"device_id": c["device_id"], "state": c["state"],
             "device_type": c["device_type"],
             "last_received_at": c["last_received_at"].isoformat()
             if c["last_received_at"] else None}
            for c in connections
        ],
        "tanks": tank_out,
        "stations": [
            {"station_id": s["station_id"], "station_type": s["station_type"],
             "state": s["state"]}
            for s in stations
        ],
        "rack": dict(rack) if rack else {},
    }


@router.get("/farms/{farm_id}/environment/history")
async def environment_history(farm_id: str, sensor_type: str, hours: int = 24,
                              bucket_min: int = 30):
    """환경 이력 집계 — 통계 차트·센서 상세 24h 추이 (FR-14).

    TimescaleDB time_bucket 으로 서버에서 집계한다 (원시 행을 브라우저로 보내지 않음).
    """
    hours = max(1, min(hours, 24 * 31))
    bucket_min = max(1, min(bucket_min, 1440))
    async with _engine().connect() as conn:
        rows = (
            await conn.execute(text(
                "SELECT time_bucket(make_interval(mins => :bm), ts) AS bucket, "
                "       avg(value) AS avg_value, min(value) AS min_value, max(value) AS max_value "
                "FROM mw.environment_reading "
                "WHERE farm_id = :farm AND sensor_type = :stype "
                "  AND ts > now() - make_interval(hours => :hrs) "
                "GROUP BY bucket ORDER BY bucket"
            ), {"farm": farm_id, "stype": sensor_type, "hrs": hours, "bm": bucket_min})
        ).mappings().all()
    return [
        {"ts": r["bucket"].isoformat(), "avg": round(float(r["avg_value"]), 2),
         "min": round(float(r["min_value"]), 2), "max": round(float(r["max_value"]), 2)}
        for r in rows
    ]


@router.get("/farms/{farm_id}/environment/summary")
async def environment_summary(farm_id: str, hours: int = 24):
    """기간 요약 KPI — 센서 유형별 평균·최소·최대 (통계 화면 상단)."""
    hours = max(1, min(hours, 24 * 31))
    async with _engine().connect() as conn:
        rows = (
            await conn.execute(text(
                "SELECT sensor_type, avg(value) AS avg_value, min(value) AS min_value, "
                "       max(value) AS max_value, count(*) AS n "
                "FROM mw.environment_reading "
                "WHERE farm_id = :farm AND ts > now() - make_interval(hours => :hrs) "
                "GROUP BY sensor_type ORDER BY sensor_type"
            ), {"farm": farm_id, "hrs": hours})
        ).mappings().all()
    return [
        {"sensor_type": r["sensor_type"], "avg": round(float(r["avg_value"]), 2),
         "min": round(float(r["min_value"]), 2), "max": round(float(r["max_value"]), 2),
         "count": r["n"]}
        for r in rows
    ]
