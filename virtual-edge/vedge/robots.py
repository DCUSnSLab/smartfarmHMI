"""로봇 상태 시뮬레이션 — 로봇별 독립 태스크, robot_status 발행 (§4.2).

behavior 2종 (edge-sim 에서 이식):
- transport   : 이동↔작업 순환 (cycle_sec 주기), 배터리 선형 감소 후 리셋
- charge_cycle: 대기↔충전 순환, 충전 구간에서 배터리 회복

원격 전체 정지(state.stopped) 중에는 mission idle·speed 0
— Cat.2 운전 정지(제어된 정지, 전원 유지) 모사. 상태 발행은 계속된다.
"""

import asyncio
import logging
import math
import time

import aiomqtt

from vedge import contract
from vedge.config import FarmConfig, RobotSpec
from vedge.state import FarmState

log = logging.getLogger("vedge.robots")

FRAME = "farm_local"  # 좌표계 식별 — 원점·스케일 확정 전 논리 프레임 (OPN-21)


class RobotSim:
    def __init__(self, spec: RobotSpec, cfg: FarmConfig, state: FarmState):
        self.spec = spec
        self.cfg = cfg
        self.state = state
        self._t0 = time.time()

    def _status(self) -> dict:
        t = time.time() - self._t0
        s = self.spec

        if self.state.stopped:
            # 원격 전체 정지 — 제자리 정지 (모니터링을 위한 상태 발행은 유지)
            return {"x": 1.0, "y": 1.0, "speed": 0.0, "battery_pct": 80,
                    "charging": False, "mission_state": "idle"}

        phase = (t % s.cycle_sec) / s.cycle_sec
        if s.behavior == "transport":
            moving = phase < 0.5
            return {
                "x": round(2 + 8 * phase, 2),
                "y": round(3 + 2 * math.sin(phase * 6), 2),
                "speed": 0.6 if moving else 0.0,
                "battery_pct": max(20, 95 - int((t % 7200) / 7200 * 60)),
                "charging": False,
                "mission_state": "moving" if moving else "working",
            }
        # charge_cycle — 대기 70% / 충전 30%
        charging = phase > 0.7
        return {
            "x": 0.5, "y": 0.5, "speed": 0.0,
            "battery_pct": min(100, 40 + int(phase * 70)),
            "charging": charging,
            "mission_state": "charging" if charging else "idle",
        }

    async def run(self, client: aiomqtt.Client) -> None:
        while True:
            st = self._status()
            payload = contract.robot_status(
                self.cfg.farm_id, self.spec.id,
                x=st["x"], y=st["y"], frame=FRAME, speed=st["speed"],
                battery_pct=st["battery_pct"], charging=st["charging"],
                mission_state=st["mission_state"],
            )
            await client.publish(
                contract.topic(self.cfg.farm_id, "robot", self.spec.id, "status"),
                contract.dump(payload), qos=contract.QOS, retain=True,  # §3 status
            )
            await asyncio.sleep(self.spec.interval_sec)
