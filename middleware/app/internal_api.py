"""내부 조회 REST — 애플리케이션 서버 전용 (외부 공개 없음, communication-interface.md §7).

실시간은 내부 MQTT 재발행으로 흐르고, 여기는 초기 로드·이력 조회를 담당한다.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m

router = APIRouter(prefix="/internal")


class FarmUpsert(BaseModel):
    farm_id: str
    name: str
    farm_type: str = "greenhouse"
    crop: str | None = None


@router.post("/farms")
async def upsert_farm(req: FarmUpsert):
    """농장 등록 (멱등 upsert) — FR-38 다농장의 초석.

    가상 엣지 연동 테스트가 둘째 농장을 붙일 때 사용한다. 미등록 농장의
    birth 는 FK 로 거부되므로, 데이터 수신 전에 반드시 등록해야 한다.
    """
    if req.farm_type not in ("greenhouse", "plant_factory", "open_field"):
        raise HTTPException(400, f"허용되지 않는 farm_type: {req.farm_type}")
    async with _engine().begin() as conn:
        await conn.execute(
            insert(m.farm)
            .values(farm_id=req.farm_id, name=req.name,
                    farm_type=req.farm_type, crop=req.crop)
            .on_conflict_do_update(
                index_elements=["farm_id"],
                set_={"name": req.name, "farm_type": req.farm_type, "crop": req.crop},
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
             "last_received_at": c["last_received_at"].isoformat()
             if c["last_received_at"] else None}
            for c in connections
        ],
    }
