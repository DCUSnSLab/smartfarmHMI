"""MQTT 메시지 스키마 (통신 규격 0.2) — 서비스 간 유일한 공유 코드.

**middleware 만** import 한다. virtual-edge 는 통신 규격 문서만으로 독립
구현하고(계약 검증 목적), api·web 은 내부 토픽/REST 계약으로만 통신한다
(tech-stack.md §3 경계 규칙).
"""

from typing import Annotated, Union

from pydantic import Field, TypeAdapter

from shared.schemas.messages import (
    Ack,
    Birth,
    BirthMetric,
    Calibrate,
    ControlCommand,
    Death,
    EstopState,
    Heartbeat,
    PalletTaskMsg,
    Position,
    RemoteStop,
    RemoteStopRelease,
    RobotStatusMsg,
)
from shared.schemas.sensor import SensorReading

AnyMessage = Annotated[
    Union[
        SensorReading,
        RobotStatusMsg,
        PalletTaskMsg,
        ControlCommand,
        Calibrate,
        RemoteStop,
        RemoteStopRelease,
        EstopState,
        Ack,
        Birth,
        Death,
        Heartbeat,
    ],
    Field(discriminator="type"),
]

_adapter: TypeAdapter = TypeAdapter(AnyMessage)


def parse_message(raw: bytes | str):
    """페이로드(JSON) → 타입별 모델. 알 수 없는 type·검증 실패 시 ValidationError."""
    return _adapter.validate_json(raw)


__all__ = [
    "Ack", "AnyMessage", "Birth", "BirthMetric", "Calibrate", "ControlCommand",
    "Death", "EstopState", "Heartbeat", "PalletTaskMsg", "Position", "RemoteStop",
    "RemoteStopRelease", "RobotStatusMsg", "SensorReading", "parse_message",
]
