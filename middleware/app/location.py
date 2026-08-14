"""현재 좌표를 농장 주소·우편번호·행정구역코드로 변환한다."""

import asyncio
import json
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import urlopen

from middleware.app.config import settings
from middleware.app.weather import KST, _request_uv, validate_coordinates

VWORLD_ADDRESS_URL = "https://api.vworld.kr/req/address"
JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do"


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
    words = keyword.split()
    for remaining in range(len(words), 0, -1):
        search_keyword = " ".join(words[:remaining])
        addresses: list[dict[str, str]] = []
        page = 1
        total_count = 0
        while page == 1 or len(addresses) < total_count:
            payload = _get_json(
                JUSO_URL,
                {
                    "resultType": "json", "keyword": search_keyword,
                    "confmKey": settings.juso_key + "=",
                    "currentPage": page, "countPerPage": 100,
                },
            )
            results = payload.get("results", {})
            common = results.get("common", {})
            if str(common.get("errorCode")) != "0":
                raise RuntimeError(
                    f"주소 검색 오류: {common.get('errorMessage', 'unknown')}"
                )
            total_count = int(common.get("totalCount", 0) or 0)
            page_items = results.get("juso") or []
            addresses.extend(
                {
                    "zipNo": str(item.get("zipNo", "")).strip(),
                    "roadAddr": str(item.get("roadAddr", "")).strip(),
                    "jibunAddr": str(item.get("jibunAddr", "")).strip(),
                }
                for item in page_items
                if str(item.get("roadAddr", "")).strip()
            )
            if not page_items:
                break
            page += 1
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


def _region_candidates(code: str):
    yield code
    for zero_count in range(1, 11):
        yield code[:-zero_count] + ("0" * zero_count)


def _working_uv_region_code(level4_code: str) -> str | None:
    requested_at = datetime.now(KST)
    for candidate in dict.fromkeys(_region_candidates(level4_code)):
        try:
            payload = _request_uv(candidate, requested_at)
            response = payload.get("response", {})
            if str(response.get("header", {}).get("resultCode")) != "00":
                continue
            body = response.get("body", {})
            items = body.get("items", {}).get("item", [])
            if int(body.get("totalCount", 0) or 0) > 0 and items:
                return candidate
        except Exception:
            continue
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
