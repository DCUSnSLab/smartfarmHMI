"""MQTT 토픽 네임스페이스 — communication-interface.md §2.

farmon/v1/{farm_id}/{device_type}/{device_id}/{message_type}
farmon-internal/v1/{farm_id}/{stream}
"""

from typing import NamedTuple

PREFIX = "farmon/v1"
INTERNAL_PREFIX = "farmon-internal/v1"

MESSAGE_TYPES = (
    "telemetry", "status", "command", "ack", "birth", "death", "heartbeat",
    "layout",      # §4.9.1 엣지 → 미들웨어 배치도 (retained)
    "stop_state",  # §4.6.1 미들웨어 → 엣지 원격 정지 상태 (retained)
)

# 내부 재발행 스트림. 전부 retained 라 settings_api._clear_retained 의 삭제
# 목록이기도 하다 — 새 스트림은 반드시 여기에 등록할 것.
STREAMS = (
    "environment", "robot", "connection", "layout", "alert", "command", "stop",
)

# 서버 자신의 생존을 나르는 자리 — farm_id 칸에 들어가지만 농장이 아니다.
# 밑줄로 시작해 실제 farm_id 와 겹치지 않고, 농장을 접을 때 함께 지워지지도
# 않아야 하므로 STREAMS 와 목록을 나눈다.
SYSTEM_SCOPE = "_system"
SYSTEM_STREAMS = ("health",)


class ParsedTopic(NamedTuple):
    farm_id: str
    device_type: str
    device_id: str
    message_type: str


def topic(farm_id: str, device_type: str, device_id: str, message_type: str) -> str:
    return f"{PREFIX}/{farm_id}/{device_type}/{device_id}/{message_type}"


def parse_topic(value: str) -> ParsedTopic | None:
    parts = value.split("/")
    if len(parts) != 6 or "/".join(parts[:2]) != PREFIX or parts[5] not in MESSAGE_TYPES:
        return None
    return ParsedTopic(parts[2], parts[3], parts[4], parts[5])


def internal_topic(farm_id: str, stream: str) -> str:
    allowed = SYSTEM_STREAMS if farm_id == SYSTEM_SCOPE else STREAMS
    if stream not in allowed:
        raise ValueError(f"등록되지 않은 내부 스트림: {stream!r} — topics.STREAMS 에 추가할 것")
    return f"{INTERNAL_PREFIX}/{farm_id}/{stream}"


HEALTH_TOPIC = internal_topic(SYSTEM_SCOPE, "health")
