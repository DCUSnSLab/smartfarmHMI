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

# 내부 재발행 스트림. 전부 retained 라, 농장을 접을 때 지울 목록이기도 하다
# (settings_api._clear_retained). 이름이 발행 지점마다 문자열로 흩어져 있으면
# 그 목록이 조용히 낡는다 — 새 스트림이 생겨도 아무도 모르고 안 지워진다.
# internal_topic 이 여기 없는 이름을 거부해서, 등록을 빠뜨리면 즉시 터진다.
STREAMS = (
    "environment",  # 센서 측정값
    "robot",        # 로봇 상태
    "connection",   # 장치 연결 상태 전이
    "layout",       # 농장 배치도 갱신
    "alert",        # 알림 발생·확인
    "command",      # 명령 수명주기
    "stop",         # 원격/물리 정지 (§2.4)
)


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
    # 이름은 코드 안의 상수다 — 외부 입력이 아니라서 조용히 넘기지 않고 세운다.
    if stream not in STREAMS:
        raise ValueError(f"등록되지 않은 내부 스트림: {stream!r} — topics.STREAMS 에 추가할 것")
    return f"{INTERNAL_PREFIX}/{farm_id}/{stream}"
