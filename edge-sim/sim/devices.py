"""시뮬레이션 장치 구성 — 시드(middleware/scripts/seed.py)와 일치해야 한다.

값 생성은 일변화 사인 곡선 + 노이즈. EDGE_SIM_ANOMALY=1 이면 간헐적으로
이상값(상한 초과)을 섞는다 — 알림(증분 6) 검증용.
"""

import math
import os
import random
from dataclasses import dataclass


@dataclass(frozen=True)
class SensorSpec:
    sensor_id: str
    sensor_type: str
    unit: str
    base: float
    amplitude: float  # 일변화 폭
    noise: float
    location: str


GROWBED_ID = "growbed-01"

SENSORS: list[SensorSpec] = [
    SensorSpec("temp-a", "temperature", "celsius", 24.5, 1.5, 0.15, "입구 측 상단"),
    SensorSpec("hum-a", "humidity", "percent", 60.0, 5.0, 0.8, "중앙 통로"),
    SensorSpec("ec-a", "ec", "mS/cm", 1.8, 0.1, 0.03, "공급 라인"),
    SensorSpec("co2-a", "co2", "ppm", 550.0, 120.0, 15.0, "천장 중앙"),
    SensorSpec("illum-a", "illuminance", "klx", 15.0, 8.0, 0.5, "입구 측"),
    SensorSpec("power-a", "power", "kW", 4.2, 0.8, 0.1, "배전반"),
]

ROBOTS = ["robot-01", "robot-02"]

ANOMALY = os.environ.get("EDGE_SIM_ANOMALY", "0") == "1"

# 제어 명령이 적용한 목표값 — sensor_type → base 대체값 (FR-10 피드백 가시화)
TARGETS: dict[str, float] = {}

# 원격 전체 정지 상태 (FR-35) — True 면 로봇 정지 모사
STOPPED: dict[str, bool] = {"value": False}

# command → 대상 sensor_type (set_led 는 % → klx 환산)
COMMAND_SENSOR = {
    "set_temperature": "temperature",
    "set_humidity": "humidity",
    "set_ec": "ec",
    "set_led": "illuminance",
}


def apply_command(command: str, params: dict) -> bool:
    """control_command 적용 — 이후 생성값의 base 가 목표값으로 이동한다."""
    stype = COMMAND_SENSOR.get(command)
    if stype is None:
        return False
    target = params.get("target")
    if target is None:
        return False
    if command == "set_led":  # LED 밝기 % → 조도 klx (시뮬레이션 환산)
        target = float(target) / 100.0 * 25.0
    TARGETS[stype] = float(target)
    return True


def sensor_value(spec: SensorSpec, t_sec: float) -> float:
    """일변화(86400s 주기) 사인 + 노이즈. 데모가 지루하지 않게 10분 주기 성분도 섞는다."""
    base = TARGETS.get(spec.sensor_type, spec.base)
    daily = math.sin(t_sec / 86400.0 * 2 * math.pi)
    short = 0.3 * math.sin(t_sec / 600.0 * 2 * math.pi)
    value = base + spec.amplitude * (daily + short) / 1.3 + random.gauss(0, spec.noise)
    if ANOMALY and random.random() < 0.02:  # 2% 확률 이상값
        value = base + spec.amplitude * 3
    return round(value, 2)


def robot_state(device_id: str, t_sec: float) -> dict:
    """R-1 은 순환 임무(이동↔작업), R-2 는 대기·충전을 오간다."""
    if STOPPED["value"]:
        # 원격 전체 정지 중 — 제자리 정지 (Cat.2: 제어된 정지, 전원 유지)
        return {"position": {"x": 1.0, "y": 1.0, "frame": "farm_local"}, "speed": 0.0,
                "battery_pct": 80, "charging": False, "mission_state": "idle"}
    if device_id == "robot-01":
        phase = (t_sec % 300) / 300  # 5분 주기
        moving = phase < 0.5
        return {
            "position": {"x": round(2 + 8 * phase, 2), "y": round(3 + 2 * math.sin(phase * 6), 2),
                         "frame": "farm_local"},
            "speed": 0.6 if moving else 0.0,
            "battery_pct": max(20, 95 - int((t_sec % 7200) / 7200 * 60)),
            "charging": False,
            "mission_state": "moving" if moving else "working",
        }
    phase = (t_sec % 1800) / 1800  # 30분 주기
    charging = phase > 0.7
    return {
        "position": {"x": 0.5, "y": 0.5, "frame": "farm_local"},
        "speed": 0.0,
        "battery_pct": min(100, 40 + int(phase * 70)),
        "charging": charging,
        "mission_state": "charging" if charging else "idle",
    }
