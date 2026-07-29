"""센서 데이터 메시지 — communication-interface.md §4.1."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class SensorReading(BaseModel):
    """엣지 → 미들웨어: 센서값 (FR-08, FR-39).

    `sensor_id` 가 개별 센서 식별의 핵심이다 — 한 생육기에 같은 유형의
    센서가 여러 대 분산 배치되므로 device_id+sensor_type 만으로는 부족하다.
    """

    model_config = ConfigDict(extra="allow")  # 확장 필드 허용 (비기능 §1 확장성)

    type: Literal["sensor_reading"] = "sensor_reading"
    version: str = "0.2"
    farm_id: str
    device_id: str
    sensor_id: str
    sensor_type: str
    location: str | None = None
    value: float
    unit: str
    sensor_state: Literal["ok", "degraded", "fault"] = "ok"
    timestamp: datetime
