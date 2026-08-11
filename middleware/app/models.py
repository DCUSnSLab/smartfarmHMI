"""mw 스키마 테이블 정의 — docs/02-domain/db-schema.md §3 의 구현.

SQLAlchemy Core Table 로 정의한다 (ORM 클래스 아님) — 수집기(증분 2)의
insert 인터페이스와 마이그레이션의 단일 소스.

하이퍼테이블 3종(environment_reading·robot_status·weather_reading)은
파티션 키(ts)를 포함한 복합 PK 를 갖는다 — QoS1 중복 배달 시
ON CONFLICT DO NOTHING 멱등 적재의 근거이기도 하다.
하이퍼테이블 변환·압축 정책은 Alembic 마이그레이션에서 수행한다.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

metadata = sa.MetaData(schema="mw")

_JSONB_EMPTY = sa.text("'{}'::jsonb")
_NOW = sa.func.now()


def _created_updated():
    return (
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    )


# ── 3.1 조직·장비 ─────────────────────────────────────────────

farm = sa.Table(
    "farm",
    metadata,
    sa.Column("farm_id", sa.Text, primary_key=True),  # 자연키 — MQTT 토픽 경로와 1:1
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("farm_type", sa.Text, nullable=False),
    sa.Column("crop", sa.Text),
    sa.Column("region_code", sa.Text),  # 10자리 행정구역코드
    sa.Column("latitude", sa.Double),
    sa.Column("longitude", sa.Double),
    sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    *_created_updated(),
    sa.CheckConstraint(
        "farm_type IN ('greenhouse','plant_factory','open_field')", name="farm_type_check"
    ),
)

device_meta = sa.Table(
    "device_meta",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("device_type", sa.Text, nullable=False),
    sa.Column("name", sa.Text, nullable=False),
    sa.Column("model", sa.Text),
    sa.Column("location", sa.Text),
    sa.Column("registered_by", sa.Text),  # app.user 참조값 (스키마 경계: FK 없음)
    sa.Column("deleted_at", sa.TIMESTAMP(timezone=True)),  # 소프트 삭제 (FR-07·13)
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    *_created_updated(),
    sa.UniqueConstraint("farm_id", "device_id", name="uq_device_meta_farm_device"),
    sa.CheckConstraint(
        "device_type IN ('robot','growbed','tank','station','sensor','edge','actuator')",
        name="device_type_check",
    ),
)


def registered(farm_col, device_col):
    """대장에 오른 장치인가 — (farm_id, device_id) 를 가진 이력·상태 표에 건다.

    운영 화면의 장치 목록은 이 조건으로만 만든다. 이력에서 device_id 를 뽑아
    목록을 만들면 「한 번이라도 발행했음」이 곧 「이 농장의 장비임」이 되어,
    잠깐 켰다 끈 장치가 영원히 남는다. 무엇이 이 농장의 장비인지는 사람이
    정한다 — 그 자리가 device_meta 다.

    등록되지 않은 장치는 사라지는 게 아니라 설정 화면의 「미등록」 칸에 모인다
    (settings_api._unregistered_devices). 거기서 등록하거나 그대로 둔다.

    조건을 여기 한 번만 둔다 — 목록마다 따로 적으면 한쪽만 고쳐져 결과가 갈린다.
    """
    return sa.exists().where(
        device_meta.c.farm_id == farm_col,
        device_meta.c.device_id == device_col,
        device_meta.c.deleted_at.is_(None),
    )


sensor = sa.Table(
    "sensor",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column(
        "device_meta_id", sa.BigInteger, sa.ForeignKey("device_meta.id"), nullable=False, unique=True
    ),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("sensor_id", sa.Text, nullable=False),  # MQTT sensor_id — 개별 식별 핵심
    sa.Column("parent_device_id", sa.Text),  # 소속 생육기 device_id
    sa.Column("sensor_type", sa.Text, nullable=False),  # birth 선언으로 확장 — CHECK 없음 (수집기 검증)
    sa.Column("unit", sa.Text, nullable=False),
    sa.Column("location", sa.Text),
    sa.Column("last_value", sa.Double),  # 최신값 캐시 (대시보드용)
    sa.Column("last_ts", sa.TIMESTAMP(timezone=True)),
    sa.Column("sensor_state", sa.Text, nullable=False, server_default=sa.text("'ok'")),
    *_created_updated(),
    sa.UniqueConstraint("farm_id", "sensor_id", name="uq_sensor_farm_sensor"),
    sa.CheckConstraint("sensor_state IN ('ok','degraded','fault')", name="sensor_state_check"),
)

sensor_calibration = sa.Table(
    "sensor_calibration",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("sensor_id_ref", sa.BigInteger, sa.ForeignKey("sensor.id"), nullable=False),
    sa.Column("command_id", sa.Text, sa.ForeignKey("command_log.command_id")),
    sa.Column("mode", sa.Text, nullable=False, server_default=sa.text("'zero_offset'")),
    sa.Column("before_value", sa.Double),
    sa.Column("after_value", sa.Double),
    sa.Column("performed_by", sa.Text),
    sa.Column("performed_at", sa.TIMESTAMP(timezone=True), nullable=False),
)

tank = sa.Table(
    "tank",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column(
        "device_meta_id", sa.BigInteger, sa.ForeignKey("device_meta.id"), nullable=False, unique=True
    ),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("tank_type", sa.Text, nullable=False),
    sa.Column("capacity_l", sa.Double, nullable=False),
    sa.Column("current_level_pct", sa.Double),  # 최신 수위 캐시
    sa.Column("consumption_rate", sa.Double),  # 잔량 환산("2일분") 근거
    sa.Column("consumption_unit", sa.Text),
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.CheckConstraint(
        "tank_type IN ('nutrient','water','pesticide','cleaning')", name="tank_type_check"
    ),
    sa.CheckConstraint(
        "consumption_unit IS NULL OR consumption_unit IN ('per_day','per_task')",
        name="tank_consumption_unit_check",
    ),
)

# 액추에이터 — 생육환경 제어 대상(히터·가습기·양액기·LED 등). sensor/tank 와 동형
# (device_meta 1:1). command 는 commands.py 의 ALLOWED_COMMANDS 와 정합.
actuator = sa.Table(
    "actuator",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column(
        "device_meta_id", sa.BigInteger, sa.ForeignKey("device_meta.id"), nullable=False, unique=True
    ),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("actuator_id", sa.Text, nullable=False),  # MQTT device_id 와 대응
    sa.Column("command", sa.Text, nullable=False),  # 제어 명령 종류
    sa.Column("affects_sensor_id", sa.Text),  # 결합 센서 sensor_id (선택)
    sa.Column("power_kw", sa.Double),  # 작동 부하 (선택)
    sa.Column("location", sa.Text),
    *_created_updated(),
    sa.UniqueConstraint("farm_id", "actuator_id", name="uq_actuator_farm_actuator"),
    sa.CheckConstraint(
        "command IN ('set_temperature','set_humidity','set_ec','set_led','set_auto_mode')",
        name="actuator_command_check",
    ),
)

device_connection_state = sa.Table(
    "device_connection_state",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("device_type", sa.Text),  # birth 자기기술 — 정지 명령의 엣지 식별에 사용
    sa.Column("state", sa.Text, nullable=False),
    sa.Column("last_birth_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("last_death_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("last_received_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("birth_metrics", JSONB),  # birth 의 metrics 선언 원문 보존
    sa.Column("publish_interval_sec", sa.Integer),  # 판정 배수 기준 (통신 규격 §5)
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.UniqueConstraint("farm_id", "device_id", name="uq_dcs_farm_device"),
    sa.CheckConstraint("state IN ('online','degraded','offline')", name="dcs_state_check"),
)

# 발견 버퍼 — 미들웨어에 미등록이지만 데이터가 들어오는 팜/장치를 임시 보존한다.
# 설정 화면 "발견된 스마트팜"의 소스. farm FK 없음(미등록이 존재 이유) — ingest 의
# FK 거부 지점에서 별도 트랜잭션으로 upsert 하고, 등록되면 해당 farm 행을 삭제한다.
pending_registration = sa.Table(
    "pending_registration",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("device_type", sa.Text),  # birth 자기기술 (telemetry 만 온 경우 NULL)
    # 발견 센서 누적: [{"sensor_id","sensor_type","unit"}]
    sa.Column("sensors", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    sa.Column("publish_interval_sec", sa.Integer),
    sa.Column("first_seen", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.Column("last_seen", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.Column("msg_count", sa.Integer, nullable=False, server_default=sa.text("0")),
    sa.UniqueConstraint("farm_id", "device_id", name="uq_pending_farm_device"),
)

# ── 3.2 로봇·작업 ─────────────────────────────────────────────

# 하이퍼테이블 — FK 없음 (적재 성능·파티션 제약, db-schema.md §5)
robot_status = sa.Table(
    "robot_status",
    metadata,
    sa.Column("ts", sa.TIMESTAMP(timezone=True), nullable=False),  # 파티션 키 (엣지 발생 시각)
    sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("farm_id", sa.Text, nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("pos_x", sa.Double),
    sa.Column("pos_y", sa.Double),
    sa.Column("pos_frame", sa.Text),  # 좌표계 식별 (OPN-21)
    sa.Column("speed", sa.Double),
    sa.Column("battery_pct", sa.SmallInteger),
    sa.Column("charging", sa.Boolean, nullable=False, server_default=sa.false()),
    # phase 는 "어디까지 갔나"(상태), error 는 "무엇이 틀어졌나"(사건).
    # 0.2 의 mission_state 는 둘을 한 칸에 담아 사건이 상태를 덮었다 (§4.2).
    sa.Column("phase", sa.Text, nullable=False, server_default=sa.text("'idle'")),
    sa.Column("current_task_id", sa.Text),
    sa.Column("error", JSONB),
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.PrimaryKeyConstraint("farm_id", "device_id", "ts", name="pk_robot_status"),
    sa.CheckConstraint(
        "battery_pct IS NULL OR (battery_pct BETWEEN 0 AND 100)", name="robot_battery_check"
    ),
    sa.CheckConstraint(
        "phase IN ('idle','moving','working','charging')",
        name="robot_phase_check",
    ),
)

rack_slot = sa.Table(
    "rack_slot",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("slot_id", sa.Text, nullable=False),  # 예: rack-a-03
    sa.Column("zone", sa.Text),  # 소속 존 (슬롯 → 자기를 담은 존)
    sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.UniqueConstraint("farm_id", "slot_id", name="uq_rack_slot_farm_slot"),
)

work_station = sa.Table(
    "work_station",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("station_id", sa.Text, nullable=False),
    sa.Column("station_type", sa.Text, nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default=sa.text("'idle'")),
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.UniqueConstraint("farm_id", "station_id", name="uq_work_station_farm_station"),
    sa.CheckConstraint(
        "station_type IN ('nutrient','water','pesticide','cleaning')",
        name="station_type_check",
    ),
    sa.CheckConstraint("state IN ('idle','busy','fault')", name="station_state_check"),
)

pallet = sa.Table(
    "pallet",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("pallet_id", sa.Text, nullable=False),
    sa.Column("home_slot_id", sa.BigInteger, sa.ForeignKey("rack_slot.id"), nullable=False),
    sa.Column("state", sa.Text, nullable=False, server_default=sa.text("'stored'")),
    sa.Column("current_slot_id", sa.BigInteger, sa.ForeignKey("rack_slot.id")),
    sa.Column("current_station_id", sa.BigInteger, sa.ForeignKey("work_station.id")),
    sa.Column("crop_batch", sa.Text),
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.UniqueConstraint("farm_id", "pallet_id", name="uq_pallet_farm_pallet"),
    sa.CheckConstraint("state IN ('stored','moving','at_station')", name="pallet_state_check"),
)

command_log = sa.Table(
    "command_log",
    metadata,
    sa.Column("command_id", sa.Text, primary_key=True),  # 멱등성 키 (비기능 §4)
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("command_type", sa.Text, nullable=False),
    sa.Column("payload", JSONB, nullable=False),  # 발행 메시지 원문
    sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'issued'")),
    sa.Column("issued_by", sa.Text),
    sa.Column("issued_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.Column("timeout_sec", sa.Integer, nullable=False),
    sa.Column("last_ack_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("ack_detail", JSONB),
    sa.CheckConstraint(
        "status IN ('issued','accepted','rejected','completed','failed','timeout')",
        name="command_status_check",
    ),
    sa.Index("ix_command_log_farm_issued", "farm_id", "issued_at"),
)

task_schedule = sa.Table(
    "task_schedule",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text),  # 대상 생육기 (생육기 축은 OPN-16)
    sa.Column("task_type", sa.Text, nullable=False),
    sa.Column("times_of_day", ARRAY(sa.Time), nullable=False),  # 1일 실행 시각 (FR-19)
    sa.Column("mode", sa.Text, nullable=False, server_default=sa.text("'manual'")),
    sa.Column("params", JSONB, nullable=False, server_default=_JSONB_EMPTY),  # 양·농도 (FR-21~26)
    sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("created_by", sa.Text),
    *_created_updated(),
    sa.CheckConstraint(
        "task_type IN ('nutrient','water','pesticide')", name="task_schedule_type_check"
    ),
    sa.CheckConstraint("mode IN ('manual','auto')", name="task_schedule_mode_check"),
)

pallet_task = sa.Table(
    "pallet_task",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("task_id", sa.Text, nullable=False, unique=True),  # MQTT 발행 식별자 (pt-...)
    sa.Column("command_id", sa.Text, sa.ForeignKey("command_log.command_id")),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("pallet_id", sa.BigInteger, sa.ForeignKey("pallet.id"), nullable=False),
    sa.Column("robot_device_id", sa.Text),
    sa.Column("from_slot_id", sa.BigInteger, sa.ForeignKey("rack_slot.id"), nullable=False),
    sa.Column("station_id", sa.BigInteger, sa.ForeignKey("work_station.id"), nullable=False),
    sa.Column("task_type", sa.Text, nullable=False),
    sa.Column("params", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'issued'")),
    sa.Column("issued_by", sa.Text),
    sa.Column("source_schedule_id", sa.BigInteger, sa.ForeignKey("task_schedule.id")),
    sa.Column("issued_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.Column("completed_at", sa.TIMESTAMP(timezone=True)),
    sa.CheckConstraint(
        "task_type IN ('nutrient','water','pesticide')", name="pallet_task_type_check"
    ),
    sa.CheckConstraint(
        "status IN ('issued','accepted','in_progress','completed','failed','timeout')",
        name="pallet_task_status_check",
    ),
    # 충돌 검사 3자원 질의용 (FR-03)
    sa.Index("ix_pallet_task_farm_robot", "farm_id", "robot_device_id", "issued_at"),
    sa.Index("ix_pallet_task_farm_station", "farm_id", "station_id", "issued_at"),
    sa.Index("ix_pallet_task_farm_pallet", "farm_id", "pallet_id", "issued_at"),
)

robot_task_log = sa.Table(
    "robot_task_log",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("task_kind", sa.Text, nullable=False),  # 적엽·반출·이동·반납 (수확 제외)
    sa.Column("result", sa.Text, nullable=False),
    sa.Column("retry_count", sa.SmallInteger, nullable=False, server_default=sa.text("0")),
    sa.Column("quantity", sa.Double),
    sa.Column("quantity_unit", sa.Text),
    sa.Column("pallet_task_id", sa.BigInteger, sa.ForeignKey("pallet_task.id")),
    sa.Column("started_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.CheckConstraint("result IN ('success','failure')", name="robot_task_result_check"),
    sa.Index("ix_robot_task_log_farm_finished", "farm_id", "finished_at"),
)

robot_schedule = sa.Table(
    "robot_schedule",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("task_type", sa.Text, nullable=False),
    sa.Column("pallet_id", sa.Text),
    sa.Column("from_slot", sa.Text),
    sa.Column("station_id", sa.Text),
    sa.Column("return_slot", sa.Text),
    sa.Column("start_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("duration_min", sa.Integer, nullable=False),
    sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'scheduled'")),
    sa.Column("created_by", sa.Text),
    *_created_updated(),
    sa.CheckConstraint(
        "task_type IN ('nutrient','water','pesticide','prune','transport')",
        name="robot_schedule_type_check",
    ),
    sa.CheckConstraint(
        "status IN ('scheduled','dispatched','done','canceled','failed')",
        name="robot_schedule_status_check",
    ),
    sa.Index("ix_robot_schedule_farm_device_start", "farm_id", "device_id", "start_at"),
    sa.Index("ix_robot_schedule_farm_station_start", "farm_id", "station_id", "start_at"),
    sa.Index("ix_robot_schedule_farm_pallet_start", "farm_id", "pallet_id", "start_at"),
)

robot_video_asset = sa.Table(
    "robot_video_asset",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("storage_key", sa.Text, nullable=False),  # MinIO 객체 키
    sa.Column("captured_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("duration_sec", sa.Integer),
    sa.Column("target_device_id", sa.Text),  # 촬영 대상 생육기
    sa.Column("purpose", sa.Text),
    sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.CheckConstraint(
        "purpose IS NULL OR purpose IN ('growth','pest','general')", name="video_purpose_check"
    ),
)

# ── 3.3 환경·생육 ─────────────────────────────────────────────

environment_reading = sa.Table(
    "environment_reading",
    metadata,
    sa.Column("ts", sa.TIMESTAMP(timezone=True), nullable=False),  # 파티션 키
    sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("farm_id", sa.Text, nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("sensor_id", sa.Text, nullable=False),
    sa.Column("sensor_type", sa.Text, nullable=False),
    sa.Column("value", sa.Double, nullable=False),
    sa.Column("unit", sa.Text, nullable=False),
    sa.Column("sensor_state", sa.Text, nullable=False, server_default=sa.text("'ok'")),
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.PrimaryKeyConstraint("farm_id", "sensor_id", "ts", name="pk_environment_reading"),
    sa.Index("ix_env_reading_farm_type_ts", "farm_id", "sensor_type", "ts"),
)

growth_analysis = sa.Table(
    "growth_analysis",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("video_asset_id", sa.BigInteger, sa.ForeignKey("robot_video_asset.id")),
    sa.Column("growth_rate_pct", sa.Double),
    sa.Column("pest_detected", sa.Boolean),
    sa.Column("harvest_eta", sa.Date),
    sa.Column("confidence", sa.Double),
    sa.Column("analyzed_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("engine", sa.Text),  # 외부 AI 연동 훅 식별
    sa.Column("result", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.CheckConstraint(
        "confidence IS NULL OR (confidence BETWEEN 0 AND 1)", name="growth_confidence_check"
    ),
)

device_control_setting = sa.Table(
    "device_control_setting",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("device_id", sa.Text, nullable=False),
    sa.Column("mode", sa.Text, nullable=False),
    sa.Column("growth_stage", sa.Text),  # auto 모드 (FR-11)
    sa.Column("ai_priority", sa.Text),  # FR-12
    sa.Column("targets", JSONB, nullable=False, server_default=_JSONB_EMPTY),  # 제어 대상 4종
    sa.Column("is_current", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("set_by", sa.Text),
    sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.CheckConstraint("mode IN ('manual','auto','ai')", name="dcs_mode_check"),
    sa.CheckConstraint(
        "ai_priority IS NULL OR ai_priority IN ('growth_first','power_first')",
        name="dcs_ai_priority_check",
    ),
    # 이력 보존: 현재 설정은 장비당 1행 (부분 UNIQUE)
    sa.Index(
        "uq_dcs_current",
        "farm_id",
        "device_id",
        unique=True,
        postgresql_where=sa.text("is_current"),
    ),
)

weather_reading = sa.Table(
    "weather_reading",
    metadata,
    sa.Column("ts", sa.TIMESTAMP(timezone=True), nullable=False),  # 관측·예보 기준 시각
    sa.Column("received_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("farm_id", sa.Text, nullable=False),
    sa.Column("temperature_c", sa.Double),
    sa.Column("humidity_pct", sa.Double),
    sa.Column("precipitation_mm", sa.Double),
    sa.Column("wind_ms", sa.Double),
    sa.Column("condition", sa.Text),
    sa.Column("solar_level", sa.Text),
    sa.Column("provider", sa.Text, nullable=False),  # OPN-17
    sa.Column("raw", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.PrimaryKeyConstraint("farm_id", "provider", "ts", name="pk_weather_reading"),
)

# ── 3.4 데이터 관리 ───────────────────────────────────────────

data_statistics = sa.Table(
    "data_statistics",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id")),  # NULL = 전체 농장
    sa.Column("device_id", sa.Text),  # NULL = 농장 전체 (생육기 축 OPN-16)
    sa.Column("period", sa.Text, nullable=False),
    sa.Column("bucket_start", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("metric", sa.Text, nullable=False),
    sa.Column("value", sa.Double, nullable=False),
    sa.Column("computed_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.CheckConstraint("period IN ('hour','day','week','month')", name="stats_period_check"),
    sa.UniqueConstraint(
        "farm_id", "device_id", "period", "bucket_start", "metric", name="uq_stats_bucket"
    ),
)

farm_report = sa.Table(
    "farm_report",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id")),  # NULL = 전 농장 리포트
    sa.Column("report_type", sa.Text, nullable=False),
    sa.Column("period_start", sa.Date, nullable=False),
    sa.Column("period_end", sa.Date, nullable=False),
    sa.Column("body", sa.Text, nullable=False),
    sa.Column("stats", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.Column("generated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.CheckConstraint(
        "report_type IN ('daily','weekly','monthly','yearly')", name="report_type_check"
    ),
    sa.UniqueConstraint("farm_id", "report_type", "period_start", name="uq_report_period"),
)

# ── 3.5 알림 ─────────────────────────────────────────────────

alert_rule = sa.Table(
    "alert_rule",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("alert_kind", sa.Text, nullable=False),
    sa.Column("sensor_type", sa.Text),  # threshold 계열 대상 항목
    sa.Column("min_value", sa.Double),  # 기본값은 OPN-20
    sa.Column("max_value", sa.Double),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("updated_by", sa.Text),
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
    sa.UniqueConstraint("farm_id", "alert_kind", "sensor_type", name="uq_alert_rule"),
)

alert = sa.Table(
    "alert",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False),
    sa.Column("severity", sa.Text, nullable=False),  # 경고/주의/완료
    sa.Column("alert_kind", sa.Text, nullable=False),
    sa.Column("device_id", sa.Text),
    sa.Column("title", sa.Text, nullable=False),
    sa.Column("body", sa.Text),
    sa.Column("deeplink", sa.Text),  # 관련 화면 라우트 (FR-33)
    sa.Column("occurred_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("acked_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("acked_by", sa.Text),
    sa.Column("rule_id", sa.BigInteger, sa.ForeignKey("alert_rule.id")),
    sa.Column("extra", JSONB, nullable=False, server_default=_JSONB_EMPTY),
    sa.CheckConstraint("severity IN ('warning','caution','info')", name="alert_severity_check"),
    sa.CheckConstraint(
        "alert_kind IN ('threshold','tank_low','device_fault','connection','stop',"
        "'task_done','task_failed')",
        name="alert_kind_check",
    ),
    sa.Index("ix_alert_farm_occurred", "farm_id", "occurred_at"),
    # 미확인 카운트용 부분 인덱스
    sa.Index("ix_alert_unacked", "farm_id", postgresql_where=sa.text("acked_at IS NULL")),
)

# ── 3.6 안전 ─────────────────────────────────────────────────

stop_event = sa.Table(
    "stop_event",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("stop_kind", sa.Text, nullable=False),  # 원격 전체 정지 / 물리 비상정지
    sa.Column("scope", sa.Text, nullable=False),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id")),
    sa.Column("engaged_at", sa.TIMESTAMP(timezone=True), nullable=False),
    sa.Column("released_at", sa.TIMESTAMP(timezone=True)),
    sa.Column("engaged_by", sa.Text),  # physical_estop 은 현장 조작 — NULL 허용
    sa.Column("released_by", sa.Text),
    sa.Column("reason", sa.Text),
    # 물리 비상정지의 원 보고 {estop, reason} — engaged|released|unknown (§4.7).
    # unknown 도 정지로 판정하되(안전측) 화면은 "현장 확인 필요"로 구분해야 하므로,
    # 판정 결과와 별개로 엣지가 뭐라고 보고했는지를 남긴다.
    sa.Column("detail", JSONB),
    sa.Column("command_id", sa.Text, sa.ForeignKey("command_log.command_id")),
    sa.CheckConstraint("stop_kind IN ('remote','physical_estop')", name="stop_kind_check"),
    sa.CheckConstraint("scope IN ('all','farm')", name="stop_scope_check"),
    # 같은 범위의 미해제 정지 중복 방지 (farm_id NULL 은 '' 로 정규화해 비교)
    sa.Index(
        "uq_stop_active",
        "stop_kind",
        "scope",
        sa.text("coalesce(farm_id, '')"),
        unique=True,
        postgresql_where=sa.text("released_at IS NULL"),
    ),
)

# ── 3.7 배치도 ───────────────────────────────────────────────

farm_layout = sa.Table(
    "farm_layout",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("farm_id", sa.Text, sa.ForeignKey("farm.farm_id"), nullable=False, unique=True),
    sa.Column("coord_frame", sa.Text),  # OPN-21
    sa.Column("origin_desc", sa.Text),
    sa.Column("scale", JSONB),
    sa.Column("background", JSONB),
    # 배치도 출처 — 엣지 자기기술(edge)과 설정 화면 수기 등록을 구분한다
    sa.Column("source", sa.Text),
    sa.Column("source_device_id", sa.Text),
    sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=_NOW),
)

layout_element = sa.Table(
    "layout_element",
    metadata,
    sa.Column("id", sa.BigInteger, sa.Identity(always=True), primary_key=True),
    sa.Column("layout_id", sa.BigInteger, sa.ForeignKey("farm_layout.id"), nullable=False),
    sa.Column("element_type", sa.Text, nullable=False),
    sa.Column("element_id", sa.Text),  # 엣지 재발행 시 교체 키 (zone id, slot id 등)
    sa.Column("ref_device_id", sa.Text),  # 딥링크 대상
    sa.Column("x", sa.Double),  # 좌표 확정 전엔 NULL + zone 논리 배치
    sa.Column("y", sa.Double),
    sa.Column("zone", sa.Text),       # 소속 존 (지점 → 자기를 담은 존)
    sa.Column("zone_type", sa.Text),  # 존 자신의 종류 (corridor/charging/...)
    sa.Column("geometry", JSONB),  # 구역 폴리곤·게이트 선분 [[x,y], ...] — 점 요소는 NULL
    sa.Column("connects", ARRAY(sa.Text)),  # gate 가 잇는 두 존
    sa.CheckConstraint(
        "element_type IN ('rack','station','tank','sensor','entrance','zone','gate','charging')",
        name="layout_element_type_check",
    ),
)

# 하이퍼테이블 목록 — 마이그레이션·수집기가 공유하는 단일 소스
HYPERTABLES = {
    "environment_reading": {"chunk": "1 day", "segmentby": "farm_id,sensor_id"},
    "robot_status": {"chunk": "1 day", "segmentby": "farm_id,device_id"},
    "weather_reading": {"chunk": "7 days", "segmentby": "farm_id"},
}
