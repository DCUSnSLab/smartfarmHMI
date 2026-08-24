"""MQTT 메시지 스키마 0.3 전체 — communication-interface.md §4.

sensor_reading 은 sensor.py (증분 0에서 선행 정의).
모든 모델은 extra="allow" — 확장 필드에 열려 있다 (비기능 §1).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# 계약 버전 — 문서 §4 와 함께 올린다. 수신 측 호환 판정은 conformance.py.
CONTRACT_VERSION = "0.3"


class _Msg(BaseModel):
    model_config = ConfigDict(extra="allow")
    version: str = CONTRACT_VERSION
    farm_id: str
    timestamp: datetime


class Position(BaseModel):
    model_config = ConfigDict(extra="allow")
    x: float
    y: float
    frame: str | None = None  # 좌표계 식별 (OPN-21)


class RobotError(BaseModel):
    """로봇 오류 — 상태가 아니라 사건이다 (§4.2).

    `phase` 와 한 필드에 담으면 사건이 상태를 덮어 어느 구간에서 멈췄는지가
    사라진다.
    """

    model_config = ConfigDict(extra="allow")
    code: str
    message: str | None = None
    severity: Literal["warning", "caution"] = "warning"
    since: datetime | None = None


class RobotStatusMsg(_Msg):
    """엣지 → 미들웨어: 로봇 상태 (§4.2, FR-04·06).

    0.3 에서 `mission_state` 를 `phase` + `error` 두 축으로 나눠, 이제
    `phase="moving"` 과 `error={...}` 가 동시에 성립한다.
    """

    type: Literal["robot_status"] = "robot_status"
    device_id: str
    position: Position | None = None
    speed: float | None = None
    battery_pct: int | None = None
    charging: bool = False
    phase: Literal["idle", "moving", "working", "charging"] = "idle"
    current_task_id: str | None = None
    error: RobotError | None = None


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


class RobotJog(_Msg):
    """미들웨어 → 엣지: 로봇 이동 조작 (개정 0.3-robot-jog §2).

    `duration_ms` 는 데드맨이다. 엣지는 이 시간이 지나면 스스로 0 속도를 낸다 —
    정지 메시지가 유실돼도 멈춘다. `speed` 는 m/s 가 아니라 0.0~1.0 정규화
    비율로, 물리 상한은 엣지가 소유한다 (개정 §3.1·§3.2).
    """

    type: Literal["robot_jog"] = "robot_jog"
    command_id: str
    device_id: str
    direction: Literal["forward", "backward", "left", "right", "stop"]
    speed: float = 0.5
    duration_ms: int = 800
    issued_by: str | None = None
    timeout_sec: int = 2


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


class RemoteStopState(_Msg):
    """미들웨어 → 엣지: 원격 정지 상태 (§4.6.1, FR-35) — retained.

    RemoteStop 이 "지금 정지하라"는 행위라면 이것은 "정지 상태다"라는 사실이다.
    명령 토픽은 retain 하지 않아 재접속한 엣지가 정지 중임을 알 방법이 없으므로,
    지속되는 쪽을 별도 retained 상태 토픽으로 나른다. 엣지는 ack 하지 않는다.
    """

    type: Literal["remote_stop_state"] = "remote_stop_state"
    device_id: str
    engaged: bool
    scope: Literal["all", "farm"] = "farm"
    reason: str | None = None


class EstopState(_Msg):
    """엣지 → 미들웨어: 물리 비상정지 상태 (§4.7, FR-36) — 표시 전용.

    해제 역방향 메시지는 존재하지 않는다 (현장 수동 조작만).

    0.3 에서 `engaged: bool` 을 3값 `estop` 으로 바꿨다. "확인해 보니 풀림"과
    "확인하지 못함"이 같은 `false` 이면 엣지가 재시작할 때마다 현장 래치가 눌린
    채여도 서버가 해제로 본다. 기본값이 `unknown` 이라 필드가 없는 메시지도
    모름으로 떨어진다 (하위호환 매핑 없음).
    """

    type: Literal["estop_state"] = "estop_state"
    device_id: str
    estop: Literal["engaged", "released", "unknown"] = "unknown"
    # unknown 일 때만: not_read_yet | read_failed | no_source
    reason: str | None = None
    source: str = "field_device"

    @property
    def is_engaged(self) -> bool:
        """정지로 판정할지. **unknown 은 engaged 와 같다** (안전측 실패).

        수신 측이 각자 구현하면 한 곳만 빠져도 안전이 조용히 열리므로 여기 모은다.
        """
        return self.estop != "released"


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


class LayoutZone(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    zone_type: str = "corridor"
    speed: float | None = None
    polygon: list[tuple[float, float]] = Field(default_factory=list)


class LayoutGate(BaseModel):
    """존과 존 사이 통로 (SD 맵 gates). 두 점을 잇는 선분."""

    model_config = ConfigDict(extra="allow")
    id: str
    between: list[str] = Field(default_factory=list)
    segment: list[tuple[float, float]] = Field(default_factory=list)


class LayoutPoint(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    point_type: Literal["rack", "station", "tank", "sensor", "entrance", "charging"] = "rack"
    x: float
    y: float
    # 이 지점을 담고 있는 존. 존과 지점은 다른 개념이고 관계는 포함이다 —
    # 한 존 안에 지점이 여러 개일 수 있다. 엣지가 폴리곤으로 판정해 채운다.
    zone: str | None = None
    # 이 자리에 놓인 장치 (device_meta.device_id). 배치도 위에 장치 표식을 겹쳐
    # 그리려면 자리와 물건이 이어져야 한다 — 지점 id 는 도면의 자리 이름이고
    # 장치는 그 자리에 놓인 물건이라, 같은 자리의 장치를 교체하면 갈라진다.
    # 비워 두면 도형만 그려지고 표식은 붙지 않는다 (좌표 확정 전의 정상 상태).
    device_id: str | None = None


class Layout(_Msg):
    """엣지 → 미들웨어: 농장 배치도 (§4.9.1, FR-41) — retained, 접속 시 1회.

    birth 가 "어떤 데이터를 내는지"의 자기기술이라면 이것은 "농장이 어떻게
    생겼는지"의 자기기술이다. frame 은 robot_status.position.frame 과 같아야
    배치도 위에 로봇을 겹쳐 그릴 수 있다 (§4.9.1 좌표계).
    """

    type: Literal["layout"] = "layout"
    device_id: str
    frame: str = "map"
    # zone 과 point 는 다른 개념이다. zone 은 주행 공간 구조(SD 맵), point 는
    # 작업 대상 지점(미션 목적지)이며 한 존 안에 여러 지점이 있을 수 있다.
    zones: list[LayoutZone] = Field(default_factory=list)
    gates: list[LayoutGate] = Field(default_factory=list)
    points: list[LayoutPoint] = Field(default_factory=list)


class Death(_Msg):
    """장치 → 미들웨어: 단절 (§4.9) — LWT 로 등록, 브로커가 대신 발행."""

    type: Literal["death"] = "death"
    device_id: str


class Heartbeat(_Msg):
    """장치 → 미들웨어: 주기적 생존 신호 (§4.9, FR-37).

    birth 로 자기기술한 뒤, 주기 데이터가 없는 장치(엣지 컨트롤러 등)가
    online 유지를 위해 interval_sec 마다 발행한다. 미들웨어는 수신 시각으로
    연결 상태를 갱신하고, 공백이 주기의 배수를 넘으면 degraded/offline 로 판정
    (LWT 즉시 offline 과 이중 방어). 재기동·시드 지연으로 birth 가 유실돼도
    다음 하트비트에 online 이 자가 복구된다.
    """

    type: Literal["heartbeat"] = "heartbeat"
    device_id: str
    interval_sec: int | None = None
