"""MQTT 메시지 스키마 0.2 전체 — communication-interface.md §4.

sensor_reading 은 sensor.py (증분 0에서 선행 정의).
모든 모델은 extra="allow" — 확장 필드에 열려 있다 (비기능 §1).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Msg(BaseModel):
    model_config = ConfigDict(extra="allow")
    version: str = "0.2"
    farm_id: str
    timestamp: datetime


class Position(BaseModel):
    model_config = ConfigDict(extra="allow")
    x: float
    y: float
    frame: str | None = None  # 좌표계 식별 (OPN-21)


class RobotStatusMsg(_Msg):
    """엣지 → 미들웨어: 로봇 상태 (§4.2, FR-04·06)."""

    type: Literal["robot_status"] = "robot_status"
    device_id: str
    position: Position | None = None
    speed: float | None = None
    battery_pct: int | None = None
    charging: bool = False
    mission_state: Literal["idle", "moving", "working", "charging", "error"] = "idle"
    current_task_id: str | None = None
    error: dict | None = None


class PalletTaskMsg(_Msg):
    """미들웨어 → 엣지: 파레트 작업 임무 (§4.3, FR-03·19~26)."""

    type: Literal["pallet_task"] = "pallet_task"
    command_id: str
    pallet_id: str
    from_slot: str
    station_id: str
    task_type: Literal["nutrient", "water", "pesticide"]
    params: dict = Field(default_factory=dict)
    issued_by: str | None = None
    timeout_sec: int = 600


class ControlCommand(_Msg):
    """미들웨어 → 엣지: 생육기 환경 제어 (§4.4, FR-10·11).

    제어 대상은 온·습도·양분·조도(LED) 4종 한정 — 환기·차광·천창 명령은 없다.
    """

    type: Literal["control_command"] = "control_command"
    command_id: str
    device_id: str
    command: str  # set_temperature | set_humidity | set_ec | set_led | set_auto_mode
    params: dict = Field(default_factory=dict)
    issued_by: str | None = None
    timeout_sec: int = 30


class Calibrate(_Msg):
    """미들웨어 → 엣지: 센서 영점 보정 (§4.5, FR-39)."""

    type: Literal["calibrate"] = "calibrate"
    command_id: str
    device_id: str
    sensor_id: str
    mode: str = "zero_offset"
    issued_by: str | None = None
    timeout_sec: int = 60


class RemoteStop(_Msg):
    """미들웨어 → 엣지: 원격 전체 정지 (§4.6, FR-35).

    안전 기능이 아니다 — IEC 60204-1 Cat.2 운전 정지 (non-functional.md §2).
    """

    type: Literal["remote_stop"] = "remote_stop"
    command_id: str
    scope: Literal["all", "farm"]
    stop_category: int = 2
    reason: str | None = None
    issued_by: str | None = None


class RemoteStopRelease(_Msg):
    type: Literal["remote_stop_release"] = "remote_stop_release"
    command_id: str
    scope: Literal["all", "farm"]
    issued_by: str | None = None


class EstopState(_Msg):
    """엣지 → 미들웨어: 물리 비상정지 상태 (§4.7, FR-36) — 표시 전용.

    해제 역방향 메시지는 존재하지 않는다 (현장 수동 조작만).
    """

    type: Literal["estop_state"] = "estop_state"
    device_id: str
    engaged: bool
    source: str = "field_device"


class Ack(_Msg):
    """엣지 → 미들웨어: 명령 응답 (§4.8). 접수와 실행 완료를 구분한다."""

    type: Literal["ack"] = "ack"
    command_id: str
    device_id: str
    result: Literal["accepted", "rejected", "completed", "failed"]
    detail: dict | None = None


class BirthMetric(BaseModel):
    model_config = ConfigDict(extra="allow")
    sensor_id: str
    sensor_type: str
    unit: str
    initial: float | None = None


class Birth(_Msg):
    """장치 → 미들웨어: 접속 선언 (§4.9, FR-37).

    장치가 자신의 데이터 항목을 스스로 선언한다 — 수집 대상 자기기술.
    """

    type: Literal["birth"] = "birth"
    device_id: str
    device_type: str
    metrics: list[BirthMetric] = Field(default_factory=list)
    publish_interval_sec: int | None = None


class Death(_Msg):
    """장치 → 미들웨어: 단절 (§4.9) — LWT 로 등록, 브로커가 대신 발행."""

    type: Literal["death"] = "death"
    device_id: str
