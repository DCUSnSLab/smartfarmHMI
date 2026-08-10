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

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from middleware.app import models as m
from middleware.app.config import settings

log = logging.getLogger("mw.weather")  # mw.* 로 통일 — main._setup_logging 이 이 트리에 핸들러를 단다
KST = ZoneInfo("Asia/Seoul")
API_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst"
UV_API_URL = "https://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5"
PROVIDER = "kma-ultra-srt-fcst"
COLLECT_MINUTE = 40

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

def validate_coordinates(latitude: float, longitude: float) -> tuple[float, float]:
    """대한민국 범위의 WGS84 위도·경도를 검증한다."""
    if not (32.0 <= latitude <= 40.0 and 123.0 <= longitude <= 133.0):
        raise ValueError("대한민국 범위를 벗어난 위치입니다")
    return latitude, longitude


def _base_datetime() -> tuple[str, str]:
    """현재 이용 가능한 가장 최근 초단기예보 발표 시각(HH30)을 반환한다."""
    target = datetime.now(KST)
    if target.minute < COLLECT_MINUTE:
        target -= timedelta(hours=1)
    return target.strftime("%Y%m%d"), target.strftime("%H30")


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

def _condition(sky_value: object, pty_value: object) -> str | None:
    """SKY·PTY 코드를 화면에서 안전하게 분리할 수 있는 단일 값으로 조합한다."""
    sky = _number(sky_value)
    pty = _number(pty_value)
    if sky is None or pty is None or not sky.is_integer() or not pty.is_integer():
        return None
    sky_code, pty_code = int(sky), int(pty)
    if sky_code not in {1, 3, 4} or pty_code not in range(8):
        return None
    return f"SKY{sky_code}-PTY{pty_code}"


def _request_weather(nx: int, ny: int) -> dict:
    base_date, base_time = _base_datetime()
    params = {
        "serviceKey": settings.weather_key, "pageNo": 1, "numOfRows": 100,
        "dataType": "JSON", "base_date": base_date, "base_time": base_time,
        "nx": nx, "ny": ny,
    }
    with urlopen(f"{API_URL}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _request_uv(region_code: str, requested_at: datetime) -> dict:
    params = {
        "ServiceKey": settings.weather_key,
        "pageNo": 1,
        "numOfRows": 10,
        "dataType": "json",
        "areaNo": region_code,
        "time": requested_at.strftime("%Y%m%d0000"),
    }
    with urlopen(f"{UV_API_URL}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _nearest_uv_field(requested_at: datetime) -> str:
    """현재 시각에 가장 가까운 3시간 단위 자외선지수 필드를 반환한다."""
    minutes = requested_at.hour * 60 + requested_at.minute
    nearest_hour = min(24, ((minutes + 90) // 180) * 3)
    return f"h{nearest_hour}"


def _uv_index(payload: dict, requested_at: datetime) -> str | None:
    response = payload.get("response", {})
    header = response.get("header", {})
    if str(header.get("resultCode")) != "00":
        raise RuntimeError(f"자외선지수 API 오류: {header.get('resultMsg', 'unknown')}")
    items = response.get("body", {}).get("items", {}).get("item", [])
    if isinstance(items, dict):
        items = [items]
    if not items:
        return None
    field = _nearest_uv_field(requested_at)
    value = _number(items[0].get(field))
    if value is None:
        return None
    return str(int(value)) if value.is_integer() else str(value)


async def fetch_weather(
    region_code: str, latitude: float, longitude: float
) -> dict:
    latitude, longitude = validate_coordinates(latitude, longitude)
    if not (len(region_code) == 10 and region_code.isdigit()):
        raise ValueError("region_code는 10자리 행정구역코드여야 합니다")
    nx, ny = map_to_grid(latitude, longitude)
    requested_at = datetime.now(KST)
    weather_result, uv_result = await asyncio.gather(
        asyncio.to_thread(_request_weather, nx, ny),
        asyncio.to_thread(_request_uv, region_code, requested_at),
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

    solar_level: str | None = None
    if isinstance(uv_result, BaseException):
        log.warning("자외선지수 수집 실패 region=%s: %s", region_code, uv_result)
        uv_raw: object = {"error": str(uv_result)}
    else:
        uv_raw = uv_result
        try:
            solar_level = _uv_index(uv_result, requested_at)
        except Exception as exc:
            log.warning("자외선지수 응답 처리 실패 region=%s: %s", region_code, exc)
            uv_raw = {**uv_result, "_error": str(exc)}

    return {
        "ts": forecast_at,
        "received_at": datetime.now(timezone.utc),
        "temperature_c": _number(values.get("T1H")),
        "humidity_pct": _number(values.get("REH")),
        "precipitation_mm": _precipitation(values.get("RN1")),
        "wind_ms": _number(values.get("WSD")),
        "condition": _condition(values.get("SKY"), values.get("PTY")),
        "solar_level": solar_level,
        "provider": PROVIDER,
        "raw": {**payload, "_uv": uv_raw},
    }


async def collect_location_weather(
    engine,
    region_code: str,
    latitude: float,
    longitude: float,
    farm_ids: list[str],
) -> None:
    """동일 행정구역·좌표를 한 번 조회해 해당 위치의 모든 농장에 저장한다."""
    try:
        reading = await fetch_weather(region_code, latitude, longitude)
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
        log.exception(
            "기상 수집 실패 region=%s lat=%s lon=%s farms=%s",
            region_code, latitude, longitude, farm_ids,
        )


async def collect_farm_weather(
    engine,
    farm_id: str,
    region_code: str,
    latitude: float,
    longitude: float,
) -> None:
    """신규 등록·위치 변경 농장의 최초 날씨를 즉시 한 번 수집한다."""
    await collect_location_weather(
        engine, region_code, latitude, longitude, [farm_id]
    )


async def collect_weather(engine) -> None:
    async with engine.connect() as conn:
        farms = (
            await conn.execute(
                select(
                    m.farm.c.farm_id,
                    m.farm.c.region_code,
                    m.farm.c.latitude,
                    m.farm.c.longitude,
                ).where(
                    m.farm.c.is_active,
                    m.farm.c.region_code.is_not(None),
                    m.farm.c.latitude.is_not(None),
                    m.farm.c.longitude.is_not(None),
                )
            )
        ).mappings().all()
    by_location: dict[tuple[str, float, float], list[str]] = {}
    for farm in farms:
        location = (
            farm["region_code"], farm["latitude"], farm["longitude"]
        )
        by_location.setdefault(location, []).append(farm["farm_id"])

    for (region_code, latitude, longitude), farm_ids in by_location.items():
        await collect_location_weather(
            engine, region_code, latitude, longitude, farm_ids
        )


def seconds_until_next_collection(now: datetime | None = None) -> float:
    """한국시간 기준 다음 매시 40분까지 남은 초."""
    current = now.astimezone(KST) if now is not None else datetime.now(KST)
    target = current.replace(minute=COLLECT_MINUTE, second=0, microsecond=0)
    if target <= current:
        target += timedelta(hours=1)
    return (target - current).total_seconds()


def last_collection_at(now: datetime | None = None) -> datetime:
    """직전 수집 경계(가장 최근의 매시 40분) — 이번 시각대 자료를 받았는지 판정용."""
    current = now.astimezone(KST) if now is not None else datetime.now(KST)
    target = current.replace(minute=COLLECT_MINUTE, second=0, microsecond=0)
    if target > current:
        target -= timedelta(hours=1)
    return target


async def _has_current_slot(engine) -> bool:
    """이번 시각대 자료를 이미 받아뒀는가."""
    async with engine.connect() as conn:
        newest = (
            await conn.execute(select(func.max(m.weather_reading.c.received_at)))
        ).scalar()
    return newest is not None and newest >= last_collection_at()


async def weather_collection_loop(engine) -> None:
    """기상청 자료 갱신 후인 매시 40분에 농장별 날씨를 수집한다.

    기동 직후 한 번은 즉시 받는다 — 대기부터 하면 재기동 직후 접속한 사용자가 최대
    1시간 빈 날씨 카드를 본다. 이번 시각대 자료가 있으면 건너뛴다 (외부 API 재호출 방지).
    """
    if not await _has_current_slot(engine):
        await collect_weather(engine)
    while True:
        await asyncio.sleep(seconds_until_next_collection())
        await collect_weather(engine)
