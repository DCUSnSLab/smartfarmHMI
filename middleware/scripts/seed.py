"""개발 시드 — 멀티팜: 성주 참외 온실 + 진주 토마토 온실.

virtual-edge config (configs/seongju.yaml·jinju.yaml)와 1:1 이어야 한다.
멱등: ON CONFLICT DO NOTHING — 반복 실행 안전.
실행: make seed (컨테이너 안에서 python -m middleware.scripts.seed)
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.config import settings
from middleware.app import models as m

# 임계 기본값 — **잠정** (OPN-20 확정 시 교체). 시뮬레이터 패턴 기준 정상 범위 밖만 발생
ALERT_RULES = [
    # (sensor_type, min, max)
    ("temperature", 15.0, 32.0),
    ("humidity", 35.0, 80.0),
    ("ec", 0.5, 2.8),
    ("co2", 250.0, 1200.0),
]

FARMS = [
    {
        "farm": {"farm_id": "seongju", "name": "성주 참외 온실",
                 "farm_type": "greenhouse", "crop": "참외", "region_code": None},
        # 디자인 전달본 farm-status 화면의 하드웨어 구성 참조
        "devices": [
            # (device_id, device_type, name, location)
            ("edge-01", "edge", "엣지 컨트롤러", "기계실"),
            ("growbed-01", "growbed", "A동 재배공간", "A동"),
            ("robot-01", "robot", "R-1 운반로봇", None),
            ("robot-02", "robot", "R-2 방제로봇", None),
            ("tank-nutrient", "tank", "양액 탱크", "기계실"),
            ("tank-water", "tank", "급수 탱크", "기계실"),
            ("tank-pesticide", "tank", "방재액 탱크", "기계실"),
            ("ws-water", "station", "WS1 급수 스테이션", "작업 구역"),
            ("ws-nutrient", "station", "WS2 양액 스테이션", "작업 구역"),
            ("ws-pesticide", "station", "WS3 방제 스테이션", "작업 구역"),
            ("temp-a", "sensor", "온도센서 A", "입구 측 상단"),
            ("hum-a", "sensor", "습도센서 A", "중앙 통로"),
            ("ec-a", "sensor", "양분(EC)센서", "공급 라인"),
            ("co2-a", "sensor", "CO₂센서", "천장 중앙"),
            ("illum-a", "sensor", "조도센서 A", "입구 측"),
            ("power-a", "sensor", "전력계", "배전반"),
            ("tank-nutrient-lv", "sensor", "양액 탱크 수위계", "양액 탱크"),
            ("tank-water-lv", "sensor", "급수 탱크 수위계", "급수 탱크"),
            ("tank-pesticide-lv", "sensor", "방재액 탱크 수위계", "방재액 탱크"),
        ],
        "sensors": [
            # (sensor_id, sensor_type, unit)
            ("temp-a", "temperature", "celsius"),
            ("hum-a", "humidity", "percent"),
            ("ec-a", "ec", "mS/cm"),
            ("co2-a", "co2", "ppm"),
            ("illum-a", "illuminance", "klx"),
            ("power-a", "power", "kW"),
            ("tank-nutrient-lv", "water_level", "percent"),
            ("tank-water-lv", "water_level", "percent"),
            ("tank-pesticide-lv", "water_level", "percent"),
        ],
        "tanks": [
            # (device_id, tank_type, capacity_l, consumption_unit, consumption_rate)
            ("tank-nutrient", "nutrient", 500.0, "per_day", 160.0),
            ("tank-water", "water", 500.0, "per_day", 100.0),
            ("tank-pesticide", "pesticide", 250.0, "per_task", 40.0),
        ],
        "stations": [("ws-water", "water"), ("ws-nutrient", "nutrient"),
                     ("ws-pesticide", "pesticide")],
        "rack_slots": [(f"rack-a-{i:02d}", "A동") for i in range(1, 13)],
        "pallets": 8,  # 슬롯 1~N 에 보관
    },
    {
        # 둘째 팜 — 기본 스택 멀티팜 (virtual-edge-jinju 서비스, configs/jinju.yaml)
        "farm": {"farm_id": "jinju", "name": "진주 토마토 온실",
                 "farm_type": "greenhouse", "crop": "토마토", "region_code": None},
        "devices": [
            ("edge-01", "edge", "엣지 컨트롤러", "기계실"),
            ("growbed-01", "growbed", "재배동", "온실 중앙"),
            ("robot-01", "robot", "R-1 운반로봇", None),
            ("tank-nutrient", "tank", "양액 탱크", "기계실"),
            ("temp-a", "sensor", "온도센서 A", "온실 중앙"),
            ("hum-a", "sensor", "습도센서 A", "온실 중앙"),
            ("ec-a", "sensor", "양분(EC)센서", "공급 라인"),
            ("power-a", "sensor", "전력계", "배전반"),
            ("tank-nutrient-lv", "sensor", "양액 탱크 수위계", "양액 탱크"),
        ],
        "sensors": [
            ("temp-a", "temperature", "celsius"),
            ("hum-a", "humidity", "percent"),
            ("ec-a", "ec", "mS/cm"),
            ("power-a", "power", "kW"),
            ("tank-nutrient-lv", "water_level", "percent"),
        ],
        "tanks": [("tank-nutrient", "nutrient", 300.0, "per_day", 90.0)],
        "stations": [("ws-nutrient", "nutrient")],
        "rack_slots": [(f"rack-a-{i:02d}", "재배동") for i in range(1, 7)],
        "pallets": 4,
    },
]


async def seed_farm(conn, spec: dict) -> None:
    farm_id = spec["farm"]["farm_id"]
    await conn.execute(insert(m.farm).values(**spec["farm"]).on_conflict_do_nothing())

    for device_id, dtype, name, loc in spec["devices"]:
        await conn.execute(
            insert(m.device_meta)
            .values(farm_id=farm_id, device_id=device_id, device_type=dtype,
                    name=name, location=loc)
            .on_conflict_do_nothing(constraint="uq_device_meta_farm_device")
        )

    rows = await conn.execute(
        select(m.device_meta.c.device_id, m.device_meta.c.id)
        .where(m.device_meta.c.farm_id == farm_id)
    )
    meta_id = dict(rows.all())

    for sensor_id, stype, unit in spec["sensors"]:
        await conn.execute(
            insert(m.sensor)
            .values(device_meta_id=meta_id[sensor_id], farm_id=farm_id,
                    sensor_id=sensor_id, parent_device_id="growbed-01",
                    sensor_type=stype, unit=unit)
            .on_conflict_do_nothing(constraint="uq_sensor_farm_sensor")
        )

    for device_id, ttype, cap, cunit, crate in spec["tanks"]:
        await conn.execute(
            insert(m.tank)
            .values(device_meta_id=meta_id[device_id], farm_id=farm_id,
                    tank_type=ttype, capacity_l=cap,
                    consumption_unit=cunit, consumption_rate=crate)
            .on_conflict_do_nothing(index_elements=["device_meta_id"])
        )

    for station_id, stype in spec["stations"]:
        await conn.execute(
            insert(m.work_station)
            .values(farm_id=farm_id, station_id=station_id, station_type=stype)
            .on_conflict_do_nothing(constraint="uq_work_station_farm_station")
        )

    for stype, lo, hi in ALERT_RULES:
        await conn.execute(
            insert(m.alert_rule)
            .values(farm_id=farm_id, alert_kind="threshold",
                    sensor_type=stype, min_value=lo, max_value=hi)
            .on_conflict_do_nothing(constraint="uq_alert_rule")
        )

    for slot_id, zone in spec["rack_slots"]:
        await conn.execute(
            insert(m.rack_slot)
            .values(farm_id=farm_id, slot_id=slot_id, zone=zone)
            .on_conflict_do_nothing(constraint="uq_rack_slot_farm_slot")
        )

    slot_rows = await conn.execute(
        select(m.rack_slot.c.slot_id, m.rack_slot.c.id)
        .where(m.rack_slot.c.farm_id == farm_id)
    )
    slot_id_map = dict(slot_rows.all())
    for i in range(1, spec["pallets"] + 1):
        home = slot_id_map[f"rack-a-{i:02d}"]
        await conn.execute(
            insert(m.pallet)
            .values(farm_id=farm_id, pallet_id=f"pallet-{i:02d}",
                    home_slot_id=home, current_slot_id=home)
            .on_conflict_do_nothing(constraint="uq_pallet_farm_pallet")
        )


async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        for spec in FARMS:
            await seed_farm(conn, spec)
    await engine.dispose()
    for spec in FARMS:
        print(f"✓ seed: {spec['farm']['farm_id']} — devices={len(spec['devices'])}, "
              f"sensors={len(spec['sensors'])}")


if __name__ == "__main__":
    asyncio.run(seed())
