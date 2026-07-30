"""센서 모델 — 센서마다 독립 asyncio 태스크로 자기 주기에 맞춰 발행한다.

값 모델:
- 일반 센서: base(또는 액추에이터 목표에 1차 지연 수렴) + 일변화 사인 + 노이즈
- water_level: 시간에 따른 자연 감소 + 액추에이터(도저) 추가 소모 — 단조 감소
- power: base + 작동 중 액추에이터 부하 합 — 물리 결합의 관찰 지점
"""

import asyncio
import logging
import math
import random
import time

import aiomqtt

from vedge import contract
from vedge.config import FarmConfig, SensorSpec
from vedge.state import FarmState

log = logging.getLogger("vedge.sensors")

CONVERGE_RATE = 0.15  # 1차 지연 수렴 계수 (틱당 잔차의 15% 접근)


class SensorSim:
    def __init__(self, spec: SensorSpec, cfg: FarmConfig, state: FarmState):
        self.spec = spec
        self.cfg = cfg
        self.state = state
        self._current = spec.base  # 수렴 모델의 현재값
        self._t0 = time.time()

    def _ambient(self, t: float) -> float:
        daily = math.sin(t / 86400.0 * 2 * math.pi)
        short = 0.3 * math.sin(t / 600.0 * 2 * math.pi)
        return self.spec.base + self.spec.amplitude * (daily + short) / 1.3

    def next_value(self) -> float:
        t = time.time()
        s = self.spec

        if s.type == "water_level":
            elapsed_h = (t - self._t0) / 3600.0
            level = s.base - s.drain_per_hour * elapsed_h - self.state.extra_drain[s.id]
            return round(max(0.0, min(100.0, level + random.gauss(0, s.noise))), 2)

        if s.type == "power":
            return round(
                max(0.0, s.base + self.state.total_load_kw() + random.gauss(0, s.noise)), 2
            )

        # 일반 환경 센서 — 목표가 있으면 1차 지연 수렴, 없으면 주변값으로 회귀
        goal = self.state.effective_target(s.id)
        if goal is None:
            goal = self._ambient(t)
        self._current += (goal - self._current) * CONVERGE_RATE
        return round(self._current + random.gauss(0, s.noise), 2)

    async def run(self, client: aiomqtt.Client) -> None:
        """센서별 독립 발행 루프 — 주기는 config 의 interval_sec."""
        s = self.spec
        while True:
            payload = contract.sensor_reading(
                self.cfg.farm_id, self.cfg.growbed_id,
                sensor_id=s.id, sensor_type=s.type, location=s.location,
                value=self.next_value(), unit=s.unit,
            )
            await client.publish(
                contract.topic(self.cfg.farm_id, "growbed", self.cfg.growbed_id, "telemetry"),
                contract.dump(payload), qos=contract.QOS, retain=True,  # §3 telemetry
            )
            await asyncio.sleep(s.interval_sec)


def birth_metrics(cfg: FarmConfig) -> list[dict]:
    """birth 의 metrics 자기기술 (§4.9) + 센서별 주기 확장 필드."""
    return [
        {"sensor_id": s.id, "sensor_type": s.type, "unit": s.unit,
         "initial": s.base, "interval_sec": s.interval_sec}  # interval_sec: 확장 필드
        for s in cfg.sensors
    ]
