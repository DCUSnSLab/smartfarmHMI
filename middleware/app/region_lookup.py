"""SGIS 행정동 경계를 이용한 오프라인 위·경도 역지오코딩."""
from functools import lru_cache
from pathlib import Path
import re

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BOUNDARY_ZIP = DATA_DIR / "bnd_dong_00_2025_2Q.zip"
KMA_REGIONS = DATA_DIR / "kma-regions.csv"
MAX_FALLBACK_DISTANCE_M = 50_000


def _normalize_name(value: object) -> str:
    name = re.sub(r"제(?=\d)", "", str(value))
    return re.sub(r"[.·ㆍ\s-]", "", name)


@lru_cache(maxsize=1)
def _datasets() -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """경계와 기상청 대표 좌표를 최초 요청 때 한 번만 읽는다."""
    if not BOUNDARY_ZIP.exists() or not KMA_REGIONS.exists():
        raise RuntimeError("행정구역 경계 데이터가 설치되지 않았습니다")

    boundaries = gpd.read_file(f"zip://{BOUNDARY_ZIP}")
    required = {"ADM_CD", "ADM_NM", "geometry"}
    if not required.issubset(boundaries.columns) or boundaries.crs is None:
        raise RuntimeError("행정구역 경계 데이터의 필드 또는 좌표계가 올바르지 않습니다")
    boundaries = boundaries[["ADM_CD", "ADM_NM", "geometry"]].copy()
    boundaries["normalized_name"] = boundaries["ADM_NM"].map(_normalize_name)

    regions = pd.read_csv(KMA_REGIONS, dtype={"code": str}).dropna(subset=["level3"])
    points = gpd.GeoDataFrame(
        regions,
        geometry=gpd.points_from_xy(regions["longitude"], regions["latitude"]),
        crs="EPSG:4326",
    ).to_crs(boundaries.crs)
    points["normalized_name"] = points["level3"].map(_normalize_name)
    return boundaries, points


def coordinates_to_region(latitude: float, longitude: float) -> dict[str, object]:
    """WGS84 좌표가 포함된 행정동을 찾아 기상청 10자리 코드를 반환한다."""
    if not (32 <= latitude <= 40 and 123 <= longitude <= 133):
        raise ValueError("대한민국 범위를 벗어난 위치입니다")

    boundaries, region_points = _datasets()
    point = (
        gpd.GeoSeries([Point(longitude, latitude)], crs="EPSG:4326")
        .to_crs(boundaries.crs)
        .iloc[0]
    )
    indexes = boundaries.sindex.query(point, predicate="within")
    if not len(indexes):
        indexes = boundaries.sindex.query(point, predicate="intersects")
    if not len(indexes):
        raise ValueError("좌표에 해당하는 행정구역을 찾지 못했습니다")

    matches = boundaries.iloc[indexes]
    boundary = matches.loc[matches.geometry.area.idxmin()]
    candidates = region_points[
        region_points["normalized_name"] == boundary["normalized_name"]
    ]
    used_name_match = not candidates.empty
    if candidates.empty:
        candidates = region_points

    distances = candidates.geometry.distance(point)
    nearest = candidates.loc[distances.idxmin()]
    distance = float(distances.min())
    if not used_name_match and distance > MAX_FALLBACK_DISTANCE_M:
        raise ValueError("행정구역을 기상청 코드와 연결하지 못했습니다")

    return {
        "region_code": str(nearest["code"]),
        "level1": str(nearest["level1"]),
        "level2": str(nearest["level2"]),
        "level3": str(nearest["level3"]),
        "latitude": float(latitude),
        "longitude": float(longitude),
        "boundary_code": str(boundary["ADM_CD"]),
        "boundary_name": str(boundary["ADM_NM"]),
    }
