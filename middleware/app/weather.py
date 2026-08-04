"""기상청 동네예보 격자 변환·초단기실황 수집."""
import asyncio
import json
import logging
import math
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.config import settings

log = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")
API_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
PROVIDER = "kma-ultra-srt-ncst"
COLLECT_MINUTE = 40
REGION_PATTERN = re.compile(r"^kma-dfs-v1:(\d{3}):(\d{3})$")

import math
NX, NY = 149, 253
_RE = 6371.00877 / 5.0
_XO, _YO = 210 / 5.0, 675 / 5.0
_DEGRAD = math.pi / 180.0
_SLAT1, _SLAT2 = 30.0 * _DEGRAD, 60.0 * _DEGRAD
_OLON, _OLAT = 126.0 * _DEGRAD, 38.0 * _DEGRAD
_SN = math.log(math.cos(_SLAT1) / math.cos(_SLAT2)) / math.log(math.tan(math.pi * 0.25 + _SLAT2 * 0.5) / math.tan(math.pi * 0.25 + _SLAT1 * 0.5))
_SF = math.tan(math.pi * 0.25 + _SLAT1 * 0.5) ** _SN * math.cos(_SLAT1) / _SN
_RO = _RE * _SF / math.tan(math.pi * 0.25 + _OLAT * 0.5) ** _SN

def map_to_grid(latitude: float, longitude: float) -> tuple[int, int]:
    """WGS84 위도·경도를 기상청 동네예보 5km 격자로 변환한다."""
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("유효하지 않은 위도 또는 경도입니다")
    ra = math.tan(math.pi * 0.25 + latitude * _DEGRAD * 0.5)
    ra = _RE * _SF / ra**_SN
    theta = longitude * _DEGRAD - _OLON
    if theta > math.pi: theta -= 2.0 * math.pi
    if theta < -math.pi: theta += 2.0 * math.pi
    theta *= _SN
    nx = int(ra * math.sin(theta) + _XO + 1.5)
    ny = int(_RO - ra * math.cos(theta) + _YO + 1.5)
    if not (1 <= nx <= NX and 1 <= ny <= NY):
        raise ValueError("기상청 동네예보 격자 범위를 벗어난 위치입니다")
    return nx, ny

def make_region_code(latitude: float, longitude: float) -> str:
    """좌표를 공급자·격자 버전 포함 지역 코드로 변환한다."""
    nx, ny = map_to_grid(latitude, longitude)
    return f"kma-dfs-v1:{nx:03d}:{ny:03d}"


def parse_region_code(region_code: str) -> tuple[int, int]:
    match = REGION_PATTERN.fullmatch(region_code)
    if match is None:
        raise ValueError(f"지원하지 않는 기상 지역 코드입니다: {region_code}")
    return int(match.group(1)), int(match.group(2))


def _base_datetime() -> tuple[str, str]:
    target = datetime.now(KST) - timedelta(minutes=40)
    return target.strftime("%Y%m%d"), target.strftime("%H00")


def _number(value: object) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group()) if match else None


def _request_weather(nx: int, ny: int) -> dict:
    base_date, base_time = _base_datetime()
    params = {
        "serviceKey": settings.weather_key, "pageNo": 1, "numOfRows": 100,
        "dataType": "JSON", "base_date": base_date, "base_time": base_time,
        "nx": nx, "ny": ny,
    }
    with urlopen(f"{API_URL}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


async def fetch_weather(region_code: str) -> dict:
    nx, ny = parse_region_code(region_code)
    payload = await asyncio.to_thread(_request_weather, nx, ny)
    response = payload.get("response", {})
    header = response.get("header", {})
    if header.get("resultCode") != "00":
        raise RuntimeError(f"기상청 API 오류: {header.get('resultMsg', 'unknown')}")
    items = response.get("body", {}).get("items", {}).get("item", [])
    values = {item["category"]: item.get("obsrValue") for item in items}
    if not items:
        raise RuntimeError("기상청 관측값이 비어 있습니다")
    observed_at = datetime.strptime(
        f"{items[0]['baseDate']}{items[0]['baseTime']}", "%Y%m%d%H%M"
    ).replace(tzinfo=KST)
    pty = int(_number(values.get("PTY")) or 0)
    condition = {
        0: "강수 없음", 1: "비", 2: "비/눈", 3: "눈",
        5: "빗방울", 6: "빗방울/눈날림", 7: "눈날림",
    }.get(pty, "알 수 없음")
    return {
        "ts": observed_at, "received_at": datetime.now(timezone.utc),
        "temperature_c": _number(values.get("T1H")),
        "humidity_pct": _number(values.get("REH")),
        "precipitation_mm": _number(values.get("RN1")),
        "wind_ms": _number(values.get("WSD")),
        "condition": condition, "solar_level": None,
        "provider": PROVIDER, "raw": payload,
    }


async def collect_region_weather(engine, region_code: str, farm_ids: list[str]) -> None:
    """한 격자를 한 번 조회해 해당 격자의 모든 농장에 저장한다."""
    try:
        reading = await fetch_weather(region_code)
        async with engine.begin() as conn:
            for farm_id in farm_ids:
                await conn.execute(
                    insert(m.weather_reading)
                    .values(farm_id=farm_id, **reading)
                    .on_conflict_do_update(
                        constraint="pk_weather_reading",
                        set_={k: v for k, v in reading.items() if k != "ts"},
                    )
                )
    except Exception:
        log.exception("기상 수집 실패 region=%s farms=%s", region_code, farm_ids)


async def collect_farm_weather(engine, farm_id: str, region_code: str) -> None:
    """신규 등록·위치 변경 농장의 최초 날씨를 즉시 한 번 수집한다."""
    await collect_region_weather(engine, region_code, [farm_id])


async def collect_weather(engine) -> None:
    async with engine.connect() as conn:
        farms = (
            await conn.execute(
                select(m.farm.c.farm_id, m.farm.c.region_code).where(
                    m.farm.c.is_active, m.farm.c.region_code.is_not(None)
                )
            )
        ).mappings().all()
    by_region: dict[str, list[str]] = {}
    for farm in farms:
        by_region.setdefault(farm["region_code"], []).append(farm["farm_id"])

    for region_code, farm_ids in by_region.items():
        await collect_region_weather(engine, region_code, farm_ids)


def seconds_until_next_collection(now: datetime | None = None) -> float:
    """한국시간 기준 다음 매시 40분까지 남은 초."""
    current = now.astimezone(KST) if now is not None else datetime.now(KST)
    target = current.replace(minute=COLLECT_MINUTE, second=0, microsecond=0)
    if target <= current:
        target += timedelta(hours=1)
    return (target - current).total_seconds()


async def weather_collection_loop(engine) -> None:
    """기상청 자료 갱신 후인 매시 40분에만 농장별 날씨를 수집한다."""
    while True:
        await asyncio.sleep(seconds_until_next_collection())
        await collect_weather(engine)
