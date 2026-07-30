"""팜 런타임 상태 — 센서·액추에이터가 공유하는 결합 지점.

- targets: 액추에이터가 적용한 목표값 (sensor_id → target). 센서가 이를 향해 수렴
- active_loads: 작동 중 액추에이터의 전력 부하 (power 센서에 합산)
- extra_drain: 도저 등이 유발한 탱크 추가 소모 누적 (%)
- stopped: 원격 전체 정지 — 액추에이터만 멈추고 센서 발행은 계속 (모니터링 유지)
"""

from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class FarmState:
    targets: dict[str, float] = field(default_factory=dict)
    active_loads: dict[str, float] = field(default_factory=dict)
    extra_drain: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    stopped: bool = False

    def total_load_kw(self) -> float:
        return sum(self.active_loads.values()) if not self.stopped else 0.0

    def effective_target(self, sensor_id: str) -> float | None:
        # 정지 중에는 목표 유지가 멈추고 주변값으로 회귀 (Cat.2: 전원 유지·작동 중단)
        if self.stopped:
            return None
        return self.targets.get(sensor_id)
