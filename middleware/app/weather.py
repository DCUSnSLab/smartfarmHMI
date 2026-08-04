"""기상청 동네예보 격자 변환·초단기예보 수집."""
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
API_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst"
SOLAR_API_URL = "https://apis.data.go.kr/B551184/SrQtyService/getSrQtyPredcInfo"
PROVIDER = "kma-ultra-srt-fcst"
COLLECT_MINUTE = 40
REGION_PATTERN = re.compile(r"^(\d{1,2}\.\d{3})-(\d{2,3}\.\d{3})$")

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
    """대한민국 WGS84 좌표를 소수점 셋째 자리의 region_code로 직렬화한다."""
    if not (32.0 <= latitude <= 40.0 and 123.0 <= longitude <= 133.0):
        raise ValueError("대한민국 범위를 벗어난 위치입니다")
    return f"{latitude:.3f}-{longitude:.3f}"


def parse_region_code(region_code: str) -> tuple[float, float]:
    """region_code에서 WGS84 위도·경도를 복원한다."""
    match = REGION_PATTERN.fullmatch(region_code)
    if match is None:
        raise ValueError(f"지원하지 않는 위치 코드입니다: {region_code}")
    latitude, longitude = float(match.group(1)), float(match.group(2))
    if not (32.0 <= latitude <= 40.0 and 123.0 <= longitude <= 133.0):
        raise ValueError(f"대한민국 범위를 벗어난 위치 코드입니다: {region_code}")
    return latitude, longitude


def _base_datetime() -> tuple[str, str]:
    """현재 이용 가능한 가장 최근 초단기예보 발표 시각(HH30)을 반환한다."""
    target = datetime.now(KST)
    if target.minute < COLLECT_MINUTE:
        target -= timedelta(hours=1)
    return target.strftime("%Y%m%d"), target.strftime("%H30")


def _solar_datetime() -> datetime:
    """현재 시각과 가장 가까운 미래의 정시 일사량 예측 시각을 반환한다."""
    now = datetime.now(KST)
    if now.minute or now.second or now.microsecond:
        return (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    return now.replace(minute=0, second=0, microsecond=0)


def _number(value: object) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    if match is None:
        return None
    number = float(match.group())
    return None if number >= 9000 or number <= -900 else number


def _precipitation(value: object) -> float | None:
    text = str(value)
    if "강수없음" in text or text.strip() == "0":
        return 0.0
    return _number(value)


def _request_weather(nx: int, ny: int) -> dict:
    base_date, base_time = _base_datetime()
    params = {
        "serviceKey": settings.weather_key, "pageNo": 1, "numOfRows": 100,
        "dataType": "JSON", "base_date": base_date, "base_time": base_time,
        "nx": nx, "ny": ny,
    }
    with urlopen(f"{API_URL}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _request_solar(latitude: float, longitude: float, target: datetime) -> dict:
    params = {
        "serviceKey": settings.weather_key,
        "pageNo": 1,
        "numOfRows": 10,
        "type": "json",
        "date": target.strftime("%Y%m%d"),
        "time": target.strftime("%H00"),
        "lat": f"{latitude:.10f}",
        "lot": f"{longitude:.10f}",
    }
    with urlopen(f"{SOLAR_API_URL}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _solar_ghi(payload: dict) -> float:
    response = payload.get("response", {})
    header = response.get("header", {})
    if str(header.get("resultCode")) != "00":
        raise RuntimeError(f"일사량 API 오류: {header.get('resultMsg', 'unknown')}")
    items = response.get("body", {}).get("items", {}).get("item", [])
    if isinstance(items, dict):
        items = [items]
    if not items:
        # 서비스는 야간 시간대에 정상 응답과 함께 item을 비워 반환한다.
        return 0.0
    ghi = _number(items[0].get("ghi"))
    if ghi is None:
        raise RuntimeError("일사량 GHI 값이 없습니다")
    return ghi


async def fetch_weather(region_code: str) -> dict:
    latitude, longitude = parse_region_code(region_code)
    nx, ny = map_to_grid(latitude, longitude)
    solar_target = _solar_datetime()
    weather_result, solar_result = await asyncio.gather(
        asyncio.to_thread(_request_weather, nx, ny),
        asyncio.to_thread(_request_solar, latitude, longitude, solar_target),
        return_exceptions=True,
    )
    if isinstance(weather_result, BaseException):
        raise weather_result
    payload = weather_result
    response = payload.get("response", {})
    header = response.get("header", {})
    if header.get("resultCode") != "00":
        raise RuntimeError(f"기상청 API 오류: {header.get('resultMsg', 'unknown')}")
    items = response.get("body", {}).get("items", {}).get("item", [])
    if not items:
        raise RuntimeError("기상청 예보값이 비어 있습니다")

    forecasts: dict[datetime, dict[str, object]] = {}
    for item in items:
        forecast_at = datetime.strptime(
            f"{item['fcstDate']}{item['fcstTime']}", "%Y%m%d%H%M"
        ).replace(tzinfo=KST)
        forecasts.setdefault(forecast_at, {})[item["category"]] = item.get("fcstValue")

    now = datetime.now(KST)
    future_slots = [slot for slot in forecasts if slot >= now]
    forecast_at = min(future_slots) if future_slots else max(forecasts)
    values = forecasts[forecast_at]

    sky = _number(values.get("SKY"))
    solar_level: str | None = None
    if isinstance(solar_result, BaseException):
        log.warning("일사량 수집 실패 region=%s: %s", region_code, solar_result)
        solar_raw: object = {"error": str(solar_result)}
    else:
        solar_raw = solar_result
        try:
            solar_level = str(_solar_ghi(solar_result))
        except Exception as exc:
            log.warning("일사량 응답 처리 실패 region=%s: %s", region_code, exc)
            solar_raw = {**solar_result, "_error": str(exc)}

    return {
        "ts": forecast_at,
        "received_at": datetime.now(timezone.utc),
        "temperature_c": _number(values.get("T1H")),
        "humidity_pct": _number(values.get("REH")),
        "precipitation_mm": _precipitation(values.get("RN1")),
        "wind_ms": _number(values.get("WSD")),
        "condition": str(int(sky)) if sky is not None else None,
        "solar_level": solar_level,
        "provider": PROVIDER,
        "raw": {**payload, "_solar": solar_raw},
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
