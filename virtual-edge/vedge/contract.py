"""통신 계약 구현 — docs/03-architecture/communication-interface.md 만을 근거로 작성.

이 파일은 의도적으로 `shared/schemas` 를 사용하지 않는다.
실제 엣지팀이 통신 규격 문서만 보고 구현하는 상황을 재현해,
문서와 미들웨어 구현의 불일치를 연동 테스트에서 드러내기 위함이다.
각 함수에 근거 조항(§)을 주석으로 남긴다.
"""

import json
import uuid
from datetime import datetime, timezone

VERSION = "0.3"  # §4 스키마 버전
PREFIX = "farmon/v1"  # §2.1 토픽 네임스페이스

# §4.9 birth.instance_id — 발행자 프로세스 식별자. 프로세스가 뜰 때 한 번 만들고
# 사는 동안 바꾸지 않는다. 재접속마다 새로 내면 미들웨어가 매번 중복 발행자로 본다.
INSTANCE_ID = uuid.uuid4().hex[:8]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def topic(farm_id: str, device_type: str, device_id: str, message_type: str) -> str:
    """§2.1 — farmon/v1/{farm_id}/{device_type}/{device_id}/{message_type}"""
    return f"{PREFIX}/{farm_id}/{device_type}/{device_id}/{message_type}"


def dump(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


# ── 발행 정책 (§3) ──
# telemetry/status : QoS1, retain=True (신규 구독자 최신값 즉시 수신)
# ack              : QoS1, retain=False
# birth/death      : QoS1, retain=True (death 는 LWT 로 등록)
QOS = 1


def sensor_reading(farm_id: str, device_id: str, *, sensor_id: str, sensor_type: str,
                   location: str | None, value: float, unit: str,
                   sensor_state: str = "ok") -> dict:
    """§4.1 — 엣지 → 미들웨어: 센서 데이터. sensor_id 가 개별 식별 핵심."""
    return {
        "type": "sensor_reading", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id,
        "sensor_id": sensor_id, "sensor_type": sensor_type, "location": location,
        "value": value, "unit": unit, "sensor_state": sensor_state,
        "timestamp": now_iso(),
    }


def robot_status(farm_id: str, device_id: str, *, x: float, y: float, frame: str,
                 speed: float, battery_pct: int, charging: bool,
                 phase: str, error: dict | None = None) -> dict:
    """§4.2 — 엣지 → 미들웨어: 로봇 상태.

    phase: idle | moving | working | charging — 임무가 어디까지 갔나(상태)
    error: null 또는 {code, message, severity, since} — 무엇이 틀어졌나(사건)

    0.3 에서 두 축이 갈렸다. 0.2 의 mission_state 는 한 칸에 둘을 담아 오류가
    진행 단계를 덮었다. 이제 phase="moving" 과 error={...} 가 동시에 성립한다.
    """
    return {
        "type": "robot_status", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id,
        "position": {"x": x, "y": y, "frame": frame},
        "speed": speed, "battery_pct": battery_pct, "charging": charging,
        "phase": phase, "error": error,
        "timestamp": now_iso(),
    }


def estop_state(farm_id: str, device_id: str, *, estop: str,
                reason: str | None = None, source: str = "field_device") -> dict:
    """§4.7 — 엣지 → 미들웨어: 물리 비상정지 상태. 표시 전용, retained.

    estop 은 세 값이다: engaged | released | unknown.
    **released 는 장치를 실제로 읽어 확인했을 때만 보낸다.** 못 읽었으면
    unknown 이고, 수신 측은 이를 engaged 와 같이(정지로) 취급한다 — 0.2 는
    둘을 같은 false 로 보내 엣지 재시작마다 안전이 조용히 열렸다.
    """
    return {
        "type": "estop_state", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id,
        "estop": estop, "reason": reason, "source": source,
        "timestamp": now_iso(),
    }


def birth(farm_id: str, device_id: str, device_type: str, *,
          metrics: list[dict], publish_interval_sec: int | None) -> dict:
    """§4.9 — 접속 선언. 장치가 발행 항목을 자기기술한다.

    관찰 포인트: 규격의 publish_interval_sec 는 장치 단위 단일 값인데
    본 구현은 센서별 주기가 다르다 → 최소 주기를 선언하고, 확장 필드로
    metrics[].interval_sec 를 함께 실어 보낸다 (§4 서두: payload 확장 허용).

    한 프로세스가 엣지·생육기·로봇의 birth 를 함께 내므로 instance_id 도 같다.
    중복 판정은 (farm, device) 단위지만 실제로 겹치는 단위는 프로세스다.
    """
    return {
        "type": "birth", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id, "device_type": device_type,
        "metrics": metrics, "publish_interval_sec": publish_interval_sec,
        "instance_id": INSTANCE_ID,
        "timestamp": now_iso(),
    }


def death(farm_id: str, device_id: str) -> dict:
    """§4.9 — LWT 로 등록. timestamp 는 접속 시점 생성이라 신뢰 불가(§3 LWT 계약)
    — 따라서 재접속 시 빈 retained 발행으로 이 메시지를 정리해야 한다."""
    return {
        "type": "death", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id, "timestamp": now_iso(),
    }


def heartbeat(farm_id: str, device_id: str, *, interval_sec: int) -> dict:
    """§4.9 — 주기적 생존 신호. 주기 데이터가 없는 장치(엣지 컨트롤러)가
    online 유지를 위해 interval_sec 마다 발행한다. 미들웨어는 수신 시각으로
    연결 상태를 갱신하고, 공백이 주기 배수를 넘으면 offline 으로 판정한다."""
    return {
        "type": "heartbeat", "version": VERSION,
        "farm_id": farm_id, "device_id": device_id, "interval_sec": interval_sec,
        "timestamp": now_iso(),
    }


def ack(farm_id: str, device_id: str, *, command_id: str, result: str,
        detail: dict | None = None) -> dict:
    """§4.8 — 명령 응답. accepted(접수)와 completed(실행 완료)를 구분한다."""
    return {
        "type": "ack", "version": VERSION,
        "farm_id": farm_id, "command_id": command_id, "device_id": device_id,
        "result": result, "detail": detail, "timestamp": now_iso(),
    }
