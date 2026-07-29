"""MQTT 메시지 스키마 (통신 규격 0.2) — 서비스 간 유일한 공유 코드.

middleware·edge-sim 만 import 한다. api·web 은 내부 토픽/REST 계약으로만
통신한다 (tech-stack.md §3 경계 규칙).

증분 0: 대표 모델(sensor_reading)만. 나머지 메시지는 증분 2 에서 추가.
"""

from shared.schemas.sensor import SensorReading

__all__ = ["SensorReading"]
