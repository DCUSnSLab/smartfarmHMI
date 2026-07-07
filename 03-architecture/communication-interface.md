# 03-2 · 통신 규격

## 1. 구간별 프로토콜

| 구간 | 프로토콜 | 방식 |
|---|---|---|
| 웹앱 ↔ 서버 | WebSocket (실시간 상태 푸시) + REST (조회·설정 CRUD) | 서버가 가진 최신 데이터를 푸시, 과거 데이터는 REST 조회 |
| 서버 ↔ 엣지 | 미정 — WebSocket, ROS2 등 검토 중 | 엣지가 주기적으로 데이터를 전송, 서버가 수신·저장 |
| 엣지 ↔ 실물 하드웨어 | 개발 범위 밖 | - |

서버가 노출하는 엣지 통신 인터페이스는 임의 데이터 생성기와 실제 엣지가 동일하게 사용한다. 데이터 흐름(엣지 주기적 전송 → 서버 저장 → 웹앱 제공)은 `system-architecture.md` 참고.

## 2. 메시지 스키마 (초안)

프로토콜(WebSocket/ROS2 등)이 확정되기 전이라도 메시지 내용 자체는 아래와 같은 형태를 참고 초안으로 둔다. 모든 메시지는 `type`, `version`, `timestamp` 필드를 포함하고, `payload`는 자유 형식 JSON으로 확장 가능하게 둔다.

### 엣지 → 서버: 센서 데이터
```json
{
  "type": "sensor_reading",
  "version": "0.1",
  "device_id": "growbed-01",
  "sensor_type": "temperature",
  "value": 24.5,
  "unit": "celsius",
  "timestamp": "2026-07-07T10:00:00+09:00"
}
```

### 엣지 → 서버: 로봇 상태
```json
{
  "type": "robot_status",
  "version": "0.1",
  "device_id": "robot-01",
  "position": { "x": 1.2, "y": 3.4 },
  "speed": 0.5,
  "battery_pct": 82,
  "error": null,
  "timestamp": "2026-07-07T10:00:00+09:00"
}
```

### 서버 → 엣지: 제어 명령
```json
{
  "type": "control_command",
  "version": "0.1",
  "device_id": "growbed-01",
  "command": "set_temperature",
  "params": { "target": 23.0 },
  "issued_by": "user-42",
  "timestamp": "2026-07-07T10:00:00+09:00"
}
```

### 서버 → 웹앱: 실시간 푸시
```json
{
  "channel": "growbed-01/environment",
  "data": { "temperature": 24.5, "humidity": 60.2 },
  "timestamp": "2026-07-07T10:00:00+09:00"
}
```

## 3. 확정 필요 항목

(README.md 참고)

- 메시지 스키마 필드 리뷰 — OPN-10

## 변경 이력
- 2026-07-07 · 최초 작성
