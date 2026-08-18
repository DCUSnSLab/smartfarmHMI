"""내부 조회 REST — 애플리케이션 서버 전용 (외부 공개 없음, communication-interface.md §7).

실시간은 내부 MQTT 재발행으로 흐르고, 여기는 초기 로드·이력 조회를 담당한다.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.weather import collect_farm_weather, validate_coordinates

router = APIRouter(prefix="/internal")


class FarmUpsert(BaseModel):
    farm_id: str
    name: str
    farm_type: str = "greenhouse"
    crop: str | None = None
    region_code: str | None = None
    address: str | None = None
    zipcode: str | None = None
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
    if req.latitude is not None and req.longitude is not None:
        try:
            validate_coordinates(req.latitude, req.longitude)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if req.region_code is not None and not (
        len(req.region_code) == 10 and req.region_code.isdigit()
    ):
        raise HTTPException(400, "region_code는 10자리 행정구역코드여야 합니다")
    async with _engine().begin() as conn:
        await conn.execute(
            insert(m.farm)
            .values(
                farm_id=req.farm_id, name=req.name, farm_type=req.farm_type,
                crop=req.crop, region_code=req.region_code, address=req.address,
                zipcode=req.zipcode, latitude=req.latitude, longitude=req.longitude,
            )
            .on_conflict_do_update(
                index_elements=["farm_id"],
                # 소프트 삭제된 팜을 재등록하면 재활성화한다.
                set_={"name": req.name, "farm_type": req.farm_type, "crop": req.crop,
                      "region_code": req.region_code, "address": req.address,
                      "zipcode": req.zipcode, "latitude": req.latitude,
                      "longitude": req.longitude, "is_active": True},
            )
        )
    # 저장 응답 전에 받아둔다 — 수집 실패는 collect_farm_weather 안에서 삼킨다
    if req.region_code and req.latitude is not None and req.longitude is not None:
        await collect_farm_weather(
            _engine(), req.farm_id, req.region_code, req.latitude, req.longitude
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
            (await conn.execute(
                select(m.device_connection_state).where(
                    m.registered(
                        m.device_connection_state.c.farm_id,
                        m.device_connection_state.c.device_id,
                    )
                )
            )).mappings().all()
        )
    by_farm: dict[str, list] = {}
    for c in conns:
        by_farm.setdefault(c["farm_id"], []).append(c["state"])
    return [
        {
            "farm_id": f["farm_id"], "name": f["name"], "farm_type": f["farm_type"],
            "address": f["address"], "zipcode": f["zipcode"],
            "crop": f["crop"], "region_code": f["region_code"],
            "latitude": f["latitude"], "longitude": f["longitude"],
            "devices_total": len(by_farm.get(f["farm_id"], [])),
            "devices_online": by_farm.get(f["farm_id"], []).count("online"),
        }
        for f in farms
    ]


@router.get("/weather")
async def latest_weather():
    """활성 농장별 최신 외부 날씨. 미수집 농장도 null 값으로 포함한다."""
    async with _engine().connect() as conn:
        rows = (
            await conn.execute(text(
                "SELECT f.farm_id, f.name, f.region_code, f.latitude, f.longitude, w.ts, w.received_at, "
                "w.temperature_c, w.humidity_pct, w.precipitation_mm, "
                "w.wind_ms, w.condition, w.solar_level, w.provider "
                "FROM mw.farm f LEFT JOIN LATERAL ("
                " SELECT * FROM mw.weather_reading wr WHERE wr.farm_id=f.farm_id AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL "
                " ORDER BY wr.ts DESC LIMIT 1"
                ") w ON true WHERE f.is_active ORDER BY f.created_at"
            ))
        ).mappings().all()
    return [dict(row) for row in rows]


@router.post("/farms/{farm_id}/weather/refresh")
async def refresh_farm_weather(farm_id: str):
    """위치는 있지만 기상 정보가 없는 농장의 날씨를 즉시 다시 수집한다."""
    async with _engine().connect() as conn:
        farm = (
            await conn.execute(
                select(m.farm).where(
                    m.farm.c.farm_id == farm_id,
                    m.farm.c.is_active,
                )
            )
        ).mappings().first()
    if farm is None:
        raise HTTPException(404, f"unknown farm: {farm_id}")
    if (
        farm["region_code"] is None
        or farm["latitude"] is None
        or farm["longitude"] is None
    ):
        raise HTTPException(400, "농장 위치 정보가 설정되지 않았습니다")

    # 수집기는 실패를 로그로만 남기고 예외를 삼킨다 (weather.collect_location_weather).
    # 이번 호출로 실제 적재됐는지로만 성공을 판정할 수 있고, 이 확인이 없으면
    # 기상청이 죽어 있어도 화면에는 「새로고침 완료」로 보인다.
    started = datetime.now(timezone.utc)
    await collect_farm_weather(
        _engine(), farm_id, farm["region_code"], farm["latitude"], farm["longitude"],
    )
    async with _engine().connect() as conn:
        newest = (
            await conn.execute(
                select(func.max(m.weather_reading.c.received_at))
                .where(m.weather_reading.c.farm_id == farm_id)
            )
        ).scalar()
    if newest is None or newest < started:
        raise HTTPException(502, "기상 정보를 받아오지 못했습니다")
    return {"ok": True}


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

        # 표시 이름을 따로 모아 붙인다 — 화면이 사유를 적을 때 device_id 를 그대로 쓰면
        # 「co2-a 값 두절」처럼 사람이 못 알아보는 문구가 된다 (목록은 「CO₂센서」로 부른다).
        # 조인 대신 map 을 쓰는 이유: not_soft_deleted 가 device_meta 를 참조하는
        # 상관 서브쿼리라, 같은 표를 FROM 에 넣으면 자동 상관으로 서브쿼리가 비어 버린다.
        names = {
            r["device_id"]: r["name"]
            for r in (await conn.execute(
                select(m.device_meta.c.device_id, m.device_meta.c.name)
                .where(m.device_meta.c.farm_id == farm_id)
            )).mappings().all()
        }
        sensors = (
            (await conn.execute(
                select(m.sensor).where(m.sensor.c.farm_id == farm_id)
                .order_by(m.sensor.c.sensor_id)
            )).mappings().all()
        )
        robots = (
            (await conn.execute(text(
                # 명단은 대장(device_meta), 값은 이력(robot_status). 이력에서 명단을
                # 만들면 한 번 발행한 장치가 영원히 남는다 (models.registered).
                # 등록되지 않은 로봇은 설정 화면 「미등록」 칸에 모인다.
                "SELECT DISTINCT ON (r.device_id) r.device_id, r.ts, r.pos_x, r.pos_y, r.speed, "
                "r.battery_pct, r.charging, r.phase, r.error "
                "FROM mw.robot_status r "
                "JOIN mw.device_meta d "
                "  ON d.farm_id = r.farm_id AND d.device_id = r.device_id "
                " AND d.deleted_at IS NULL "
                "WHERE r.farm_id = :farm "
                "ORDER BY r.device_id, r.ts DESC"
            ), {"farm": farm_id})).mappings().all()
        )
        connections = (
            (await conn.execute(
                select(m.device_connection_state)
                .where(m.device_connection_state.c.farm_id == farm_id)
                .where(m.registered(
                    m.device_connection_state.c.farm_id,
                    m.device_connection_state.c.device_id,
                ))
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
            {"sensor_id": s["sensor_id"], "name": names.get(s["sensor_id"]),
             "sensor_type": s["sensor_type"], "unit": s["unit"],
             "location": s["location"], "value": s["last_value"],
             "ts": s["last_ts"].isoformat() if s["last_ts"] else None,
             "sensor_state": s["sensor_state"]}
            for s in sensors
        ],
        "robots": [
            {"device_id": r["device_id"], "ts": r["ts"].isoformat(),
             "pos_x": r["pos_x"], "pos_y": r["pos_y"], "speed": r["speed"],
             "battery_pct": r["battery_pct"], "charging": r["charging"],
             "phase": r["phase"], "error": r["error"]}
            for r in robots
        ],
        "connections": [
            {"device_id": c["device_id"], "name": names.get(c["device_id"]), "state": c["state"],
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


@router.get("/farms/{farm_id}/layout")
async def farm_layout(farm_id: str):
    """농장 배치도 (§4.9.1, FR-41) — 구역 폴리곤 + 지점.

    엣지가 발행한 자기기술을 DB 에서 읽는다. 브로커 retained 가 아니라 DB 가
    출처이므로 **엣지가 꺼져 있어도 도면이 뜬다.** 좌표는 변환하지 않고 엣지
    프레임(미터) 그대로 내보낸다 — 화면 맞춤은 렌더러가 viewBox 로 처리한다.
    """
    async with _engine().connect() as conn:
        layout = (
            (await conn.execute(
                select(m.farm_layout).where(m.farm_layout.c.farm_id == farm_id)
            )).mappings().first()
        )
        if layout is None:
            # 404 가 아니다 — 배치도 없음은 정상 상태이고, 화면은 빈 도면을 그린다.
            return {"farm_id": farm_id, "frame": None, "zones": [], "gates": [], "points": [],
                    "source": None, "updated_at": None}
        elements = (
            (await conn.execute(
                select(m.layout_element)
                .where(m.layout_element.c.layout_id == layout["id"])
                .order_by(m.layout_element.c.element_type, m.layout_element.c.element_id)
            )).mappings().all()
        )

    zones = [
        {"id": e["element_id"], "zone_type": e["zone_type"], "polygon": e["geometry"] or []}
        for e in elements if e["element_type"] == "zone"
    ]
    gates = [
        {"id": e["element_id"], "between": e["connects"] or [], "segment": e["geometry"] or []}
        for e in elements if e["element_type"] == "gate"
    ]
    points = [
        {"id": e["element_id"], "point_type": e["element_type"],
         "x": e["x"], "y": e["y"], "zone": e["zone"], "ref_device_id": e["ref_device_id"]}
        for e in elements if e["element_type"] not in ("zone", "gate")
    ]
    return {
        "farm_id": farm_id,
        "frame": layout["coord_frame"],
        "origin_desc": layout["origin_desc"],
        "scale": layout["scale"],
        "source": layout["source"],
        "zones": zones,
        "gates": gates,
        "points": points,
        "updated_at": layout["updated_at"].isoformat() if layout["updated_at"] else None,
    }
