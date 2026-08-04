"""기상청 동네예보 격자 좌표 변환 유틸리티."""
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
