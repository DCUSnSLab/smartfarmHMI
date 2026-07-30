"""팜 구성 로드 — 컨테이너 1개 = 팜 1개 = config YAML 1개.

VEDGE_CONFIG 환경 변수(기본 /configs/farm.yaml)의 YAML 을 읽고,
브로커 접속 정보는 MQTT_HOST/MQTT_PORT 환경 변수가 YAML 보다 우선한다.
"""

import os
from dataclasses import dataclass, field

import yaml


@dataclass(frozen=True)
class SensorSpec:
    id: str
    type: str
    unit: str
    interval_sec: float
    base: float
    amplitude: float = 0.0
    noise: float = 0.0
    location: str | None = None
    drain_per_hour: float = 0.0  # water_level 전용 — 시간당 자연 감소(%)


@dataclass(frozen=True)
class ActuatorSpec:
    id: str
    command: str          # set_temperature | set_humidity | set_ec | set_led
    affects: str          # 결합 센서 id
    power_kw: float = 0.0  # 작동 중 전력 부하 (power 센서에 합산)
    drains: str | None = None  # 작동 시 추가 소모시키는 water_level 센서 id


@dataclass(frozen=True)
class RobotSpec:
    id: str
    behavior: str              # transport(이동↔작업 순환) | charge_cycle(대기↔충전)
    interval_sec: float = 5.0  # robot_status 발행 주기
    cycle_sec: float = 300.0   # 행동 순환 주기 (transport: 이동↔작업, charge_cycle: 대기↔충전)


@dataclass(frozen=True)
class FarmConfig:
    farm_id: str
    edge_id: str
    growbed_id: str
    mqtt_host: str
    mqtt_port: int
    sensors: list[SensorSpec] = field(default_factory=list)
    actuators: list[ActuatorSpec] = field(default_factory=list)
    robots: list[RobotSpec] = field(default_factory=list)

    @property
    def min_interval_sec(self) -> int:
        return int(min(s.interval_sec for s in self.sensors))


def load() -> FarmConfig:
    path = os.environ.get("VEDGE_CONFIG", "/configs/farm.yaml")
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    sensors = [SensorSpec(**s) for s in raw["sensors"]]
    actuators = [ActuatorSpec(**a) for a in raw.get("actuators", [])]
    robots = [RobotSpec(**r) for r in raw.get("robots", [])]
    for r in robots:
        if r.behavior not in ("transport", "charge_cycle"):
            raise ValueError(f"robot {r.id}: 알 수 없는 behavior '{r.behavior}'")

    # 결합 무결성 검증 — affects/drains 가 실제 센서를 가리키는지
    sensor_ids = {s.id for s in sensors}
    for a in actuators:
        if a.affects not in sensor_ids:
            raise ValueError(f"actuator {a.id}: affects '{a.affects}' 센서 없음")
        if a.drains and a.drains not in sensor_ids:
            raise ValueError(f"actuator {a.id}: drains '{a.drains}' 센서 없음")

    broker = raw.get("broker", {})
    return FarmConfig(
        farm_id=raw["farm_id"],
        edge_id=raw.get("edge_id", "edge-01"),
        growbed_id=raw.get("growbed_id", "growbed-01"),
        mqtt_host=os.environ.get("MQTT_HOST", broker.get("host", "host.docker.internal")),
        mqtt_port=int(os.environ.get("MQTT_PORT", broker.get("port", 41883))),
        sensors=sensors,
        actuators=actuators,
        robots=robots,
    )
