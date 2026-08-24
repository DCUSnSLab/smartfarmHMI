"""내부 조회 REST — 애플리케이션 서버 전용 (외부 공개 없음, communication-interface.md §7).

실시간은 내부 MQTT 재발행으로 흐르고, 여기는 초기 로드·이력 조회를 담당한다.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import bindparam, func, select, text
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


def _tank_view(tanks, sensors) -> list[dict]:
    """탱크 잔량 환산 — 용량·소비율로 "약 NL · N일분" (FR-08 비고)

    수위 센서와 탱크의 연결: 규약상 센서 id 가 `tank-{tank_type}-lv` 다
    (virtual-edge config·시드가 이 규약을 공유). 장비 등록 화면에서 임의 이름의
    수위 센서를 만들 수 있으므로, 매칭 실패는 정상 경로로 두고 정적 수위로 폴백한다.
    """
    level_by_type = {
        s["sensor_id"].removeprefix("tank-").removesuffix("-lv"): s["last_value"]
        for s in sensors
        if s["sensor_type"] == "water_level" and s["sensor_id"].startswith("tank-")
    }
    out = []
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
        out.append({
            "device_id": t["device_id"], "name": t["name"], "tank_type": t["tank_type"],
            "capacity_l": t["capacity_l"], "level_pct": pct, "remain_l": remain_l,
            "days_left": days, "uses_left": uses,
        })
    return out


async def _snapshots(conn, farm_ids: list[str]) -> dict[str, dict]:
    """농장별 스냅샷을 한 묶음으로 조회한다 — 표마다 1회 질의한 뒤 farm_id 로 나눈다.

    농장마다 따로 부르면 질의 수가 농장 수에 비례한다 (표 8개 × N). 대시보드는
    농장 전부를 주기적으로 다시 읽으므로 그 비례가 그대로 부하가 된다.
    """
    ids = list(dict.fromkeys(farm_ids))
    if not ids:
        return {}

    def _group(rows):
        grouped: dict[str, list] = {i: [] for i in ids}
        for r in rows:
            grouped.setdefault(r["farm_id"], []).append(r)
        return grouped

    farms = (await conn.execute(
        select(m.farm).where(m.farm.c.farm_id.in_(ids))
    )).mappings().all()

    # 표시 이름을 따로 모아 붙인다 — 화면이 사유를 적을 때 device_id 를 그대로 쓰면
    # 「co2-a 값 두절」처럼 사람이 못 알아보는 문구가 된다 (목록은 「CO₂센서」로 부른다).
    # 조인 대신 map 을 쓰는 이유: not_soft_deleted 가 device_meta 를 참조하는
    # 상관 서브쿼리라, 같은 표를 FROM 에 넣으면 자동 상관으로 서브쿼리가 비어 버린다.
    #
    # 같은 조회에서 로봇 명단도 뽑는다 — 등록만 되고 한 번도 발행하지 않은 로봇은
    # robot_status 에도 device_connection_state 에도 없어, 이것 없이는 화면에서
    # 아예 사라진다. 「없는 로봇」과 「말이 없는 로봇」은 다른 상태다.
    names: dict[str, dict[str, str]] = {i: {} for i in ids}
    robot_ids: dict[str, list[str]] = {i: [] for i in ids}
    for r in (await conn.execute(
        select(m.device_meta.c.farm_id, m.device_meta.c.device_id, m.device_meta.c.name,
               m.device_meta.c.device_type)
        .where(m.device_meta.c.farm_id.in_(ids))
        .where(m.device_meta.c.deleted_at.is_(None))
        .order_by(m.device_meta.c.farm_id, m.device_meta.c.device_id)
    )).mappings().all():
        names.setdefault(r["farm_id"], {})[r["device_id"]] = r["name"]
        if r["device_type"] == "robot":
            robot_ids.setdefault(r["farm_id"], []).append(r["device_id"])

    sensors = _group((await conn.execute(
        select(m.sensor).where(m.sensor.c.farm_id.in_(ids))
        .order_by(m.sensor.c.farm_id, m.sensor.c.sensor_id)
    )).mappings().all())

    # 명단은 대장(device_meta), 값은 이력(robot_status). 이력에서 명단을
    # 만들면 한 번 발행한 장치가 영원히 남는다 (models.registered).
    # 등록되지 않은 로봇은 설정 화면 「미등록」 칸에 모인다.
    #
    # 대장을 바깥에 두고 장치마다 LATERAL 로 최신 1행만 집는다. DISTINCT ON 으로
    # 뒤집으면 계획기가 해당 농장의 이력 전체를 정렬한다 — 2행을 얻으려 90만 행을
    # 읽고 디스크 정렬(10MB)까지 갔다. 지금은 PK(farm_id, device_id, ts) 역방향
    # 인덱스 스캔 + LIMIT 1 이라 로봇 수에만 비례한다.
    # 바깥을 device_type='robot' 으로 좁히는 것이 핵심이다 — 로봇 이력이 없는
    # 센서까지 훑으면 장치마다 압축 청크를 풀어 오히려 느려진다 (3.8초 관측).
    robots = _group((await conn.execute(
        text(
            "SELECT d.farm_id, d.device_id, r.ts, r.pos_x, r.pos_y, r.speed, "
            "r.battery_pct, r.charging, r.phase, r.error "
            "FROM mw.device_meta d "
            "CROSS JOIN LATERAL ( "
            "  SELECT s.ts, s.pos_x, s.pos_y, s.speed, s.battery_pct, "
            "         s.charging, s.phase, s.error "
            "  FROM mw.robot_status s "
            "  WHERE s.farm_id = d.farm_id AND s.device_id = d.device_id "
            "  ORDER BY s.ts DESC LIMIT 1 "
            ") r "
            "WHERE d.farm_id IN :farms AND d.deleted_at IS NULL "
            "  AND d.device_type = 'robot' "
            "ORDER BY d.farm_id, d.device_id"
        ).bindparams(bindparam("farms", expanding=True)),
        {"farms": ids},
    )).mappings().all())

    connections = _group((await conn.execute(
        select(m.device_connection_state)
        .where(m.device_connection_state.c.farm_id.in_(ids))
        .where(m.registered(
            m.device_connection_state.c.farm_id,
            m.device_connection_state.c.device_id,
        ))
    )).mappings().all())

    # 탱크·워크스테이션·랙 — 작업·공급 화면과 농장 카드 게이지 (FR-08·21~26 표시)
    tanks = _group((await conn.execute(
        select(m.tank, m.device_meta.c.device_id, m.device_meta.c.name)
        .join(m.device_meta, m.tank.c.device_meta_id == m.device_meta.c.id)
        .where(m.tank.c.farm_id.in_(ids))
        .order_by(m.tank.c.farm_id, m.tank.c.tank_type)
    )).mappings().all())

    stations = _group((await conn.execute(
        select(m.work_station).where(m.work_station.c.farm_id.in_(ids))
        .order_by(m.work_station.c.farm_id, m.work_station.c.station_id)
    )).mappings().all())

    # 적정 범위 — 설정의 알림 규칙(threshold) 상·하한. 화면의 게이지와 농장 상태
    # 판정(web fleet.farmStatus)이 **같은 기준**을 써야 하므로 상태와 함께 싣는다.
    # 따로 받아 가면 「CO₂ 적정 초과」를 화면은 경고로 그리는데 농장 점은 초록으로
    # 남는다 — 같은 순간의 같은 농장인데 근거가 둘이 된다.
    ranges = _group((await conn.execute(
        select(m.alert_rule)
        .where(m.alert_rule.c.farm_id.in_(ids))
        .where(m.alert_rule.c.alert_kind == "threshold")
        .where(m.alert_rule.c.enabled.is_(True))
        .where(m.alert_rule.c.sensor_type.isnot(None))
        .order_by(m.alert_rule.c.farm_id, m.alert_rule.c.id)
    )).mappings().all())

    slots = {
        r["farm_id"]: r["slots"]
        for r in (await conn.execute(
            text("SELECT farm_id, count(*) AS slots FROM mw.rack_slot "
                 "WHERE farm_id IN :farms GROUP BY farm_id")
            .bindparams(bindparam("farms", expanding=True)),
            {"farms": ids},
        )).mappings().all()
    }
    pallets = {
        r["farm_id"]: r
        for r in (await conn.execute(
            text("SELECT farm_id, count(*) AS pallets, "
                 "count(*) FILTER (WHERE state = 'stored') AS stored, "
                 "count(*) FILTER (WHERE state = 'moving') AS moving, "
                 "count(*) FILTER (WHERE state = 'at_station') AS at_station "
                 "FROM mw.pallet WHERE farm_id IN :farms GROUP BY farm_id")
            .bindparams(bindparam("farms", expanding=True)),
            {"farms": ids},
        )).mappings().all()
    }

    result: dict[str, dict] = {}
    for farm in farms:
        fid = farm["farm_id"]
        name_of = names.get(fid, {})
        pallet = pallets.get(fid)
        result[fid] = {
            "farm": {"farm_id": farm["farm_id"], "name": farm["name"],
                     "farm_type": farm["farm_type"], "crop": farm["crop"]},
            "sensors": [
                {"sensor_id": s["sensor_id"], "name": name_of.get(s["sensor_id"]),
                 "sensor_type": s["sensor_type"], "unit": s["unit"],
                 "location": s["location"], "value": s["last_value"],
                 "ts": s["last_ts"].isoformat() if s["last_ts"] else None,
                 "sensor_state": s["sensor_state"],
                 # 통신 판정(FR-37)이 부모를 먼저 본다 — 생육기가 끊기면 그 아래 센서의
                 # 마지막 수신 시각은 멀쩡해도 값은 과거다. 화면과 농장 상태 판정이
                 # 같은 부모를 봐야 같은 색이 나온다.
                 "parent_device_id": s["parent_device_id"]}
                for s in sensors[fid]
            ],
            "robots": [
                {"device_id": r["device_id"], "ts": r["ts"].isoformat(),
                 "pos_x": r["pos_x"], "pos_y": r["pos_y"], "speed": r["speed"],
                 "battery_pct": r["battery_pct"], "charging": r["charging"],
                 "phase": r["phase"], "error": r["error"]}
                for r in robots[fid]
            ],
            "connections": [
                {"device_id": c["device_id"], "name": name_of.get(c["device_id"]),
                 "state": c["state"], "device_type": c["device_type"],
                 "last_received_at": c["last_received_at"].isoformat()
                 if c["last_received_at"] else None}
                for c in connections[fid]
            ],
            "tanks": _tank_view(tanks[fid], sensors[fid]),
            "stations": [
                {"station_id": s["station_id"], "station_type": s["station_type"],
                 "state": s["state"], "name": name_of.get(s["station_id"])}
                for s in stations[fid]
            ],
            "ranges": {
                r["sensor_type"]: {"min": r["min_value"], "max": r["max_value"]}
                for r in ranges[fid]
            },
            "robot_ids": robot_ids.get(fid, []),
            "rack": {
                "slots": slots.get(fid, 0),
                "pallets": pallet["pallets"] if pallet else 0,
                "stored": pallet["stored"] if pallet else 0,
                "moving": pallet["moving"] if pallet else 0,
                "at_station": pallet["at_station"] if pallet else 0,
            },
        }
    return result


@router.get("/farms/snapshots")
async def farm_snapshots(ids: str = ""):
    """여러 농장의 스냅샷을 한 번에 — 농장 카드가 농장 수만큼 요청하지 않도록.

    없는 farm_id 는 결과에서 빠진다. 경로 순서상 /farms/{farm_id}/snapshot 보다
    앞에 둘 필요는 없다 (경로 모양이 겹치지 않는다).
    """
    farm_ids = [i for i in (part.strip() for part in ids.split(",")) if i]
    if not farm_ids:
        return {}
    async with _engine().connect() as conn:
        return await _snapshots(conn, farm_ids)


@router.get("/farms/{farm_id}/snapshot")
async def farm_snapshot(farm_id: str):
    """대시보드 초기 로드용 스냅샷 — 센서 최신값·로봇 최신 상태·통신 상태."""
    async with _engine().connect() as conn:
        found = await _snapshots(conn, [farm_id])
    if farm_id not in found:
        raise HTTPException(404, f"unknown farm: {farm_id}")
    return found[farm_id]


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
