"""MQTT 토픽 네임스페이스 — communication-interface.md §2.

farmon/v1/{farm_id}/{device_type}/{device_id}/{message_type}
farmon-internal/v1/{farm_id}/{stream}
"""

from typing import NamedTuple

PREFIX = "farmon/v1"
INTERNAL_PREFIX = "farmon-internal/v1"

MESSAGE_TYPES = ("telemetry", "status", "command", "ack", "birth", "death")


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
    return f"{INTERNAL_PREFIX}/{farm_id}/{stream}"
