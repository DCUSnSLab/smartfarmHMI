# 03-2 · 통신 규격

## 1. 구간별 프로토콜

| 구간 | 프로토콜 | 방식 |
|---|---|---|
| 웹앱 ↔ 애플리케이션 서버 | WebSocket (실시간 상태 푸시) + REST (조회·설정 CRUD) | 애플리케이션 서버가 가진 최신 데이터를 푸시, 과거 데이터는 REST 조회 |
| 애플리케이션 서버 ↔ 미들웨어 서버 | 미정 — 내부 REST 호출 등 검토 중 | 애플리케이션 서버가 요청을 미들웨어 서버에 위임, 미들웨어 서버가 DB·엣지 상태를 조회해 응답 |
| 미들웨어 서버 ↔ 엣지 | 미정 — WebSocket, ROS2 등 검토 중 | 엣지가 주기적으로 데이터를 전송, 미들웨어 서버가 수신·저장 |
| 엣지 ↔ 실물 하드웨어 | 개발 범위 밖 | - |

미들웨어 서버가 노출하는 엣지 통신 인터페이스는 임의 데이터 생성기와 실제 엣지가 동일하게 사용한다. 데이터 흐름(엣지 주기적 전송 → 미들웨어 서버 저장 → 애플리케이션 서버 → 웹앱 제공)은 `system-architecture.md` 참고.

## 2. 메시지 스키마 (초안)

프로토콜이 확정되기 전이라도 메시지 내용 자체는 아래와 같은 형태를 참고 초안으로 둔다. 모든 메시지는 `type`, `version`, `timestamp` 필드를 포함하고, `payload`는 자유 형식 JSON으로 확장 가능하게 둔다.

### 엣지 → 미들웨어 서버: 센서 데이터 (FR-08)
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

### 엣지 → 미들웨어 서버: 로봇 상태 (FR-04)
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

### 미들웨어 서버 → 엣지: 파레트 작업 임무 (FR-03, FR-19~26)
```json
{
  "type": "pallet_task",
  "version": "0.1",
  "pallet_id": "pallet-07",
  "from_slot": "rack-a-03",
  "station_id": "nutrient-station-01",
  "task_type": "nutrient",
  "params": { "amount_ml": 250 },
  "issued_by": "user-42",
  "timestamp": "2026-07-08T10:00:00+09:00"
}
```

### 미들웨어 서버 → 엣지: 생육기 환경 제어 명령 (FR-10 수동설정 예시. FR-11 자동모드는 "auto_mode: true" 같은 모드 전환 명령이라 형태가 다름)
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

### 애플리케이션 서버 → 웹앱: 실시간 푸시 (FR-04, FR-08 등)
```json
{
  "channel": "growbed-01/environment",
  "data": { "temperature": 24.5, "humidity": 60.2 },
  "timestamp": "2026-07-07T10:00:00+09:00"
}
```

## 3. 확정 필요 항목

(README.md 참고)

- 애플리케이션 서버 ↔ 미들웨어 서버 내부 통신 방식 — OPN-12
- 메시지 스키마 필드 리뷰 — OPN-10

## 변경 이력
- 2026-07-07 · 최초 작성
