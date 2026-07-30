"""액추에이터 — command 토픽 구독·적용·ack 응답 (§4.4·§4.6·§4.8).

- command_id 멱등: 처리한 명령 재수신 시 재적용 없이 completed 재응답 (§3 — QoS1 중복 배달)
- set_* 적용: 대상 센서의 목표값 설정 + 전력 부하 활성 + (도저) 탱크 소모
- remote_stop / release: 전 액추에이터 정지·재개 — 센서 발행은 계속
"""

import asyncio
import json
import logging

import aiomqtt

from vedge import contract
from vedge.config import FarmConfig
from vedge.state import FarmState

log = logging.getLogger("vedge.actuators")

DOSE_DRAIN_PCT = 2.0  # 도저 1회 작동당 탱크 소모(%)


class ActuatorHub:
    def __init__(self, cfg: FarmConfig, state: FarmState):
        self.cfg = cfg
        self.state = state
        self.by_command = {a.command: a for a in cfg.actuators}
        self._seen: set[str] = set()

    def _apply(self, command: str, params: dict) -> bool:
        act = self.by_command.get(command)
        if act is None:
            return False
        target = params.get("target")
        if target is None:
            return False
        target = float(target)
        if command == "set_led":  # LED 밝기 % → 조도 klx 환산 (시뮬레이션 스케일)
            target = target / 100.0 * 25.0
        self.state.targets[act.affects] = target
        if act.power_kw:
            self.state.active_loads[act.id] = act.power_kw
        if act.drains:
            self.state.extra_drain[act.drains] += DOSE_DRAIN_PCT
        log.info("actuator %s: %s → %s (%s)", act.id, command, target, act.affects)
        return True

    async def handle_commands(self, client: aiomqtt.Client) -> None:
        """farmon/v1/{farm}/+/+/command 구독 — 접수(accepted)→적용→완료(completed)."""
        async for message in client.messages:
            parts = str(message.topic).split("/")
            if len(parts) != 6 or parts[5] != "command" or not message.payload:
                continue
            device_type, device_id = parts[3], parts[4]
            try:
                body = json.loads(message.payload)
            except ValueError:
                continue
            command_id = body.get("command_id")
            if not command_id:
                continue

            async def send_ack(result: str, detail: dict | None = None):
                await client.publish(
                    contract.topic(self.cfg.farm_id, device_type, device_id, "ack"),
                    contract.dump(contract.ack(
                        self.cfg.farm_id, device_id,
                        command_id=command_id, result=result, detail=detail)),
                    qos=contract.QOS, retain=False,  # §3 — ack 는 retain 금지
                )

            if command_id in self._seen:
                log.info("duplicate command ignored: %s", command_id)
                await send_ack("completed")  # 멱등 — ack 유실 대비 재응답
                continue
            self._seen.add(command_id)

            msg_type = body.get("type")
            if msg_type in ("remote_stop", "remote_stop_release"):
                self.state.stopped = msg_type == "remote_stop"
                log.warning("remote stop %s", "engaged" if self.state.stopped else "released")
                await send_ack("completed")
                continue

            if msg_type != "control_command":
                await send_ack("rejected", {"reason": f"unsupported type: {msg_type}"})
                continue

            if self.state.stopped:
                # 정지 중 도달한 제어는 거부 — 미들웨어도 차단하지만 이중 방어 (§4.6)
                await send_ack("rejected", {"reason": "remote stop engaged"})
                continue

            await send_ack("accepted")
            ok = self._apply(body.get("command", ""), body.get("params", {}))
            await asyncio.sleep(1)  # 실행 시간 모사
            if ok:
                await send_ack("completed")
            else:
                await send_ack("failed", {"reason": f"unknown command: {body.get('command')}"})
