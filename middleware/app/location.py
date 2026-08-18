"""현재 좌표를 농장 주소·우편번호·행정구역코드로 변환한다."""

import asyncio
import json
import logging
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import urlopen

from middleware.app.config import settings
from middleware.app.weather import KST, _request_uv, validate_coordinates

log = logging.getLogger("mw.location")  # mw.* 로 통일 — main._setup_logging 이 이 트리에 핸들러를 단다

VWORLD_ADDRESS_URL = "https://api.vworld.kr/req/address"
JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do"

# JUSO 는 5초에 10건 제한이 있어 totalCount 를 페이지로 이어 받으면 제한에 걸려
# 통째로 실패한다. 후보를 100건 넘게 늘어놔도 고를 수 없으므로 첫 페이지만 받는다.
JUSO_PAGE_SIZE = 100


class LocationResolutionError(RuntimeError):
    def __init__(self, message: str, debug: dict):
        super().__init__(message)
        self.debug = debug


def _get_json(url: str, params: dict[str, object]) -> dict:
    with urlopen(f"{url}?{urlencode(params)}", timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _road_address_from_coordinates(latitude: float, longitude: float) -> str:
    payload = _get_json(
        VWORLD_ADDRESS_URL,
        {
            "service": "address", "request": "getAddress", "version": "2.0",
            "crs": "epsg:4326", "point": f"{longitude},{latitude}",
            "format": "json", "type": "both", "zipcode": "true",
            "simple": "false", "key": settings.vworld_key,
        },
    )
    response = payload.get("response", {})
    if response.get("status") != "OK":
        raise RuntimeError("현재 위치의 주소를 찾을 수 없습니다")
    result = response.get("result", {})
    if isinstance(result, list):
        result = next(
            (item for item in result if item.get("type") == "road"),
            result[0] if result else {},
        )
    address = str(result.get("text", "")).strip()
    if not address:
        raise RuntimeError("현재 위치의 주소를 찾을 수 없습니다")
    return address

def _search_addresses(keyword: str) -> list[dict[str, str]]:
    """역지오코딩된 주소를 JUSO 공식 표기로 검증한다 — 키워드당 첫 페이지만.

    전체 주소로 못 찾으면 뒤 단어부터 떼며 넓혀본다. 시도 횟수는 단어 수로 묶이고
    각 시도가 1회 호출이라, 예전처럼 totalCount 를 페이지로 훑다 제한에 걸리지 않는다.
    """
    words = keyword.split()
    for remaining in range(len(words), 0, -1):
        payload = _get_json(
            JUSO_URL,
            {
                "resultType": "json", "keyword": " ".join(words[:remaining]),
                "confmKey": settings.juso_key + "=",
                "currentPage": 1, "countPerPage": JUSO_PAGE_SIZE,
            },
        )
        results = payload.get("results", {})
        common = results.get("common", {})
        if str(common.get("errorCode")) != "0":
            raise RuntimeError(
                f"주소 검색 오류: {common.get('errorMessage', 'unknown')}"
            )
        addresses = [
            {
                "zipNo": str(item.get("zipNo", "")).strip(),
                "roadAddr": str(item.get("roadAddr", "")).strip(),
                "jibunAddr": str(item.get("jibunAddr", "")).strip(),
            }
            for item in results.get("juso") or []
            if str(item.get("roadAddr", "")).strip()
        ]
        if addresses:
            return addresses
    raise RuntimeError("도로명주소 검색 결과가 없습니다")


def search_addresses(keyword: str) -> dict:
    """사용자가 입력한 문자열로 도로명주소 후보를 검색한다."""
    payload = _get_json(JUSO_URL, {"resultType": "json", "keyword": keyword, "confmKey": settings.juso_key + "=", "currentPage": 1, "countPerPage": 100})
    results = payload.get("results", {})
    common = results.get("common", {})
    error_code = str(common.get("errorCode", ""))
    total_count = int(common.get("totalCount", 0) or 0)
    candidates = [{"zipNo": str(item.get("zipNo", "")).strip(), "roadAddr": str(item.get("roadAddr", "")).strip(), "jibunAddr": str(item.get("jibunAddr", "")).strip()} for item in results.get("juso") or [] if str(item.get("roadAddr", "")).strip()]
    return {"error_code": error_code, "message": str(common.get("errorMessage", "")).strip() if error_code != "0" else ("검색 결과 없음" if total_count == 0 else ""), "total_count": total_count, "candidates": candidates}


def _coordinates_and_code(address: str) -> tuple[float, float, str]:
    payload = _get_json(
        VWORLD_ADDRESS_URL,
        {
            "service": "address", "request": "getcoord", "version": "2.0",
            "crs": "epsg:4326", "address": address, "type": "road",
            "key": settings.vworld_key,
        },
    )
    response = payload.get("response", {})
    if response.get("status") != "OK":
        raise RuntimeError("주소의 좌표를 찾을 수 없습니다")
    result = response.get("result", {})
    point = result.get("point", {})
    longitude = float(point["x"])
    latitude = float(point["y"])
    validate_coordinates(latitude, longitude)
    code = str(response.get("refined", {}).get("structure", {}).get("level4AC", ""))
    if not (len(code) == 10 and code.isdigit()):
        raise RuntimeError("주소의 행정구역코드를 찾을 수 없습니다")
    return latitude, longitude, code


def _region_candidates(code: str) -> list[str]:
    """읍면동 → 시군구 → 시도 순으로 넓혀본다.

    예전에는 뒷자리를 한 자리씩 0 으로 밀어 후보 7개를 만들었지만, 행정구역코드는
    앞 2자리(시도)·5자리(시군구) 경계에서만 의미가 있어 나머지 4개는 헛호출이었다.
    """
    if not (len(code) == 10 and code.isdigit()):
        return []
    return list(dict.fromkeys([code, code[:5] + "00000", code[:2] + "00000000"]))


# 코드별 판정은 바뀌지 않으므로 프로세스 안에 들고 간다. 성공만 담는다 —
# 실패를 담으면 일시적인 통신 장애가 영구 결론이 된다.
_UV_REGION_CACHE: dict[str, str] = {}


def _working_uv_region_code(level4_code: str) -> str | None:
    """자외선지수 API 가 실제로 응답하는 행정구역코드를 고른다.

    기상청이 어느 코드에 응답하는지 공개된 목록이 없어 직접 물어보는 수밖에 없다.
    """
    cached = _UV_REGION_CACHE.get(level4_code)
    if cached is not None:
        return cached
    requested_at = datetime.now(KST)
    for candidate in _region_candidates(level4_code):
        try:
            payload = _request_uv(candidate, requested_at)
            response = payload.get("response", {})
            if str(response.get("header", {}).get("resultCode")) != "00":
                continue
            body = response.get("body", {})
            items = body.get("items", {}).get("item", [])
            if int(body.get("totalCount", 0) or 0) > 0 and items:
                _UV_REGION_CACHE[level4_code] = candidate
                return candidate
        except Exception as exc:
            log.warning("자외선지수 지역코드 확인 실패 code=%s: %s", candidate, exc)
    log.info("자외선지수 지역코드를 찾지 못했다 level4=%s", level4_code)
    return None


async def _resolve_address(
    address_keyword: str, address: str, zipcode: str, debug: dict
) -> dict:
    try:
        debug["address"] = address
        debug["zipcode"] = zipcode
        latitude, longitude, level4_code = await asyncio.to_thread(
            _coordinates_and_code, address
        )
        debug["latitude"] = latitude
        debug["longitude"] = longitude
        region_code = await asyncio.to_thread(_working_uv_region_code, level4_code)
        debug["region_code"] = region_code
    except Exception as exc:
        raise LocationResolutionError(str(exc), debug) from exc
    return {**debug, "region_code_warning": region_code is None}


async def resolve_selected_address(
    address_keyword: str, address: str, zipcode: str
) -> dict:
    debug = {
        "address_keyword": address_keyword,
        "address": address,
        "zipcode": zipcode,
        "latitude": None,
        "longitude": None,
        "region_code": None,
    }
    return await _resolve_address(address_keyword, address, zipcode, debug)


async def resolve_current_location(latitude: float, longitude: float) -> dict:
    debug = {
        "address_keyword": None,
        "address": None,
        "zipcode": None,
        "latitude": latitude,
        "longitude": longitude,
        "region_code": None,
    }
    try:
        validate_coordinates(latitude, longitude)
        keyword = await asyncio.to_thread(_road_address_from_coordinates, latitude, longitude)
        debug["address_keyword"] = keyword
        addresses = await asyncio.to_thread(_search_addresses, keyword)
    except Exception as exc:
        raise LocationResolutionError(str(exc), debug) from exc
    if len(addresses) > 1:
        return {
            "needs_selection": True,
            "address_keyword": keyword,
            "candidates": addresses,
            "debug": debug,
        }
    selected = addresses[0]
    return await _resolve_address(
        keyword, selected["roadAddr"], selected["zipNo"], debug
    )
