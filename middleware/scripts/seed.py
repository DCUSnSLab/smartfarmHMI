"""개발 시드 — 농장 1개(seongju) + 장비 (디자인 전달본의 성주 참외 온실 구성 참조).

멱등: ON CONFLICT DO NOTHING — 반복 실행 안전.
실행: make seed (컨테이너 안에서 python -m middleware.scripts.seed)
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.config import settings
from middleware.app import models as m

FARM = {
    "farm_id": "seongju",
    "name": "성주 참외 온실",
    "farm_type": "greenhouse",
    "crop": "참외",
    "region_code": None,  # OPN-17 확정 후
}

# 디자인 전달본 farm-status 화면의 하드웨어 구성 참조
DEVICES = [
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
]

SENSORS = [
    # (sensor_id, sensor_type, unit)
    ("temp-a", "temperature", "celsius"),
    ("hum-a", "humidity", "percent"),
    ("ec-a", "ec", "mS/cm"),
    ("co2-a", "co2", "ppm"),
    ("illum-a", "illuminance", "klx"),
    ("power-a", "power", "kW"),
]

TANKS = [
    ("tank-nutrient", "nutrient", 500.0, "per_day", 160.0),
    ("tank-water", "water", 500.0, "per_day", 100.0),
    ("tank-pesticide", "pesticide", 250.0, "per_task", 40.0),
]

STATIONS = [("ws-water", "water"), ("ws-nutrient", "nutrient"), ("ws-pesticide", "pesticide")]

RACK_SLOTS = [(f"rack-a-{i:02d}", "A동") for i in range(1, 13)]  # A동 랙 12칸


async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.execute(insert(m.farm).values(**FARM).on_conflict_do_nothing())

        for device_id, dtype, name, loc in DEVICES:
            await conn.execute(
                insert(m.device_meta)
                .values(
                    farm_id=FARM["farm_id"], device_id=device_id, device_type=dtype,
                    name=name, location=loc,
                )
                .on_conflict_do_nothing(constraint="uq_device_meta_farm_device")
            )

        # device_meta id 매핑
        rows = await conn.execute(
            select(m.device_meta.c.device_id, m.device_meta.c.id).where(
                m.device_meta.c.farm_id == FARM["farm_id"]
            )
        )
        meta_id = dict(rows.all())

        for sensor_id, stype, unit in SENSORS:
            await conn.execute(
                insert(m.sensor)
                .values(
                    device_meta_id=meta_id[sensor_id], farm_id=FARM["farm_id"],
                    sensor_id=sensor_id, parent_device_id="growbed-01",
                    sensor_type=stype, unit=unit,
                )
                .on_conflict_do_nothing(constraint="uq_sensor_farm_sensor")
            )

        for device_id, ttype, cap, cunit, crate in TANKS:
            await conn.execute(
                insert(m.tank)
                .values(
                    device_meta_id=meta_id[device_id], farm_id=FARM["farm_id"],
                    tank_type=ttype, capacity_l=cap,
                    consumption_unit=cunit, consumption_rate=crate,
                )
                .on_conflict_do_nothing(index_elements=["device_meta_id"])
            )

        for station_id, stype in STATIONS:
            await conn.execute(
                insert(m.work_station)
                .values(farm_id=FARM["farm_id"], station_id=station_id, station_type=stype)
                .on_conflict_do_nothing(constraint="uq_work_station_farm_station")
            )

        for slot_id, zone in RACK_SLOTS:
            await conn.execute(
                insert(m.rack_slot)
                .values(farm_id=FARM["farm_id"], slot_id=slot_id, zone=zone)
                .on_conflict_do_nothing(constraint="uq_rack_slot_farm_slot")
            )

        # 파레트 — 슬롯 1~8 에 보관
        slot_rows = await conn.execute(
            select(m.rack_slot.c.slot_id, m.rack_slot.c.id).where(
                m.rack_slot.c.farm_id == FARM["farm_id"]
            )
        )
        slot_id_map = dict(slot_rows.all())
        for i in range(1, 9):
            home = slot_id_map[f"rack-a-{i:02d}"]
            await conn.execute(
                insert(m.pallet)
                .values(
                    farm_id=FARM["farm_id"], pallet_id=f"pallet-{i:02d}",
                    home_slot_id=home, current_slot_id=home,
                )
                .on_conflict_do_nothing(constraint="uq_pallet_farm_pallet")
            )

    await engine.dispose()
    print("✓ seed 완료 — farm=seongju, devices=%d, sensors=%d" % (len(DEVICES), len(SENSORS)))


if __name__ == "__main__":
    asyncio.run(seed())
