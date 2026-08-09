# 03-2 · 통신 규격

## 1. 구간별 프로토콜

| 구간 | 프로토콜 | 방식 |
|---|---|---|
| 웹앱 ↔ 애플리케이션 서버 | WebSocket (실시간 상태 푸시) + REST (조회·설정 CRUD) | 애플리케이션 서버가 가진 최신 데이터를 푸시, 과거 데이터는 REST 조회 |
| 애플리케이션 서버 ↔ 미들웨어 서버 | **내부 MQTT 구독** (실시간) + **REST** (이력·설정·명령 요청) | 미들웨어 서버가 정규화해 재발행한 내부 토픽을 애플리케이션 서버가 구독. 이력 조회·설정 변경·제어 요청은 REST |
| 미들웨어 서버 ↔ 엣지 | **MQTT** | 엣지가 텔레메트리·상태를 발행, 미들웨어 서버가 구독·저장. 제어 명령은 역방향 발행 |
| 미들웨어 서버 ↔ 외부 기상 API | HTTP (주기 폴링) | 농장 소재 지역 기준 조회 후 저장·재발행 |
| 엣지 ↔ 실물 하드웨어 | 개발 범위 밖 (로봇 내부는 ROS2 등, 엣지가 브리지) | - |

임의 데이터 생성기와 실제 엣지는 **동일한 토픽·스키마**를 사용하므로 구현체 교체만으로 전환된다. 데이터 흐름(엣지 발행 → 미들웨어 저장·재발행 → 애플리케이션 서버 → 웹앱)은 `system-architecture.md` 참고.

## 2. MQTT 토픽 네임스페이스

Sparkplug B의 토픽 계층 방식을 참고했다. Sparkplug의 `group_id`가 공장·기계 단위 계층화에 쓰이는 것에 맞춰, **농장을 그룹 단위로 삼는다.** 다농장 확장 시 토픽 구조를 바꾸지 않아도 되게 하는 것이 목적이다.

### 2.1 엣지 구간 (외부)

```
farmon/v1/{farm_id}/{device_type}/{device_id}/{message_type}
```

| 요소 | 값 |
|---|---|
| `farm_id` | 농장 식별자 (예: `seongju`) |
| `device_type` | `robot` \| `growbed` \| `sensor` \| `tank` \| `station` \| `edge` |
| `device_id` | 장치 식별자 (예: `robot-01`, `temp-a`) |
| `message_type` | `telemetry` \| `status` \| `command` \| `ack` \| `birth` \| `death` \| `heartbeat` |

예시:
```
farmon/v1/seongju/sensor/temp-a/telemetry      엣지 → 미들웨어
farmon/v1/seongju/robot/robot-01/status        엣지 → 미들웨어
farmon/v1/seongju/robot/robot-01/command       미들웨어 → 엣지
farmon/v1/seongju/robot/robot-01/ack           엣지 → 미들웨어
farmon/v1/seongju/edge/edge-01/death           브로커(LWT) → 미들웨어
```

### 2.2 내부 구간 (애플리케이션 서버 구독용)

```
farmon-internal/v1/{farm_id}/{stream}
```

미들웨어 서버가 정규화한 결과를 발행하는 별도 네임스페이스다. `stream`은 `environment`, `robot`, `alert`, `weather`, `connection`, `stop` 등 화면 단위 묶음이다.

**애플리케이션 서버는 `farmon/v1/#`(엣지 원시 토픽)을 구독하지 않는다.** 설계 원칙 #2를 지키기 위한 것이며, 브로커 ACL로 애플리케이션 서버의 구독 권한을 `farmon-internal/v1/#`로 제한해 강제한다 (OPN-22).

## 3. QoS · retained · LWT 정책

| 메시지 | QoS | retained | 비고 |
|---|---|---|---|
| `telemetry` (센서값) | 1 | **true** | 신규 구독자·서버 재시작 시 최신값을 즉시 취득 |
| `status` (로봇·설비 상태) | 1 | **true** | 위와 동일 |
| `command` (제어 명령) | 1 | **false** | **retain 금지.** 명령을 retain하면 장치 재접속 시마다 과거 명령이 재배달되어 의도치 않게 재실행된다 |
| `ack` (명령 응답) | 1 | false | |
| `birth` | 1 | **true** | 장치가 발행할 항목·타입·초기값 선언 |
| `death` | 1 | **true** | LWT로 등록. 브로커가 keep-alive 만료 시 대신 발행 |
| `heartbeat` | 1 | **false** | 주기적 생존 신호(§4.9). 순간값이라 retain 금지 |

- **QoS 1을 기본으로 한다.** 스마트팜 환경에서 QoS 1이 가장 안정적인 특성을 보이는 것으로 보고된다 (`../01-requirements/non-functional.md` §4). QoS 2는 오버헤드 때문에 쓰지 않는다.
- **모든 장치는 접속 시 LWT를 등록한다.** LWT 토픽은 자신의 `death` 토픽이다. 애플리케이션이 별도로 폴링해 생존을 확인하지 않는다.
- **QoS 1은 중복 배달이 가능하므로 명령은 멱등해야 한다.** 모든 `command`는 `command_id`를 갖고, 수신 측이 이미 처리한 `command_id`를 재실행하지 않는다.

**LWT death 계약** (증분 2 구현에서 확정 — 실제 엣지 구현체에도 요구):

- LWT death 페이로드의 `timestamp`는 **접속 시점**에 만들어지므로 이후 birth 와 선후 비교에 쓸 수 없다. 수신 측은 death 를 타임스탬프 가드 없이 즉시 offline 으로 처리한다.
- 대신 **엣지는 정상 재접속 직후, birth 발행 전에 자신의 death 토픽에 빈 retained 발행(retained 삭제)을 수행**해야 한다 — 미들웨어 재시작 시 오래된 retained death 가 재배달되는 것을 발행 측에서 차단한다.
- **주기 발행이 없는 장치(엣지 컨트롤러 등)는 birth 에 하트비트 주기(`publish_interval_sec`)를 선언하고, 그 주기마다 `heartbeat` 를 발행한다**(§4.9). 미들웨어는 하트비트 수신 시각으로 online 을 유지하고 주기 배수 판정(§5)에 포함한다. LWT death 는 이와 별개로 즉시 offline 처리하는 이중 방어다. birth 가 유실(미들웨어 재시작·농장 등록 지연)돼도 다음 하트비트에 online 이 자가 복구된다.
- **엣지 컨트롤러의 death 는 해당 농장 전 장치의 offline 로 전파(cascade)** 된다 — 엣지가 유일한 통신 통로이기 때문이다 (페일세이프 ②).

## 4. 메시지 스키마 (초안)

모든 메시지는 `type`, `version`, `timestamp`를 포함하고, 확장 항목은 `payload`·`params`에 자유 형식 JSON으로 담아 필드 추가에 열려 있게 둔다. `timestamp`는 **발생 시각**이며, 미들웨어 서버는 수신 시각을 별도로 보존한다 (FR-16).

### 4.1 엣지 → 미들웨어: 센서 데이터 (FR-08, FR-39)

```json
{
  "type": "sensor_reading",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "growbed-01",
  "sensor_id": "temp-a",
  "sensor_type": "temperature",
  "location": "입구 측 상단",
  "value": 24.5,
  "unit": "celsius",
  "sensor_state": "ok",
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

`sensor_id`가 핵심 추가 항목이다. 하나의 생육기(재배공간)에 같은 유형의 센서가 여러 대 분산 배치되므로 `device_id`+`sensor_type` 조합만으로는 개별 센서를 식별할 수 없다. `sensor_state`는 `ok` \| `degraded` \| `fault`이며, 통신 기반 판정(FR-37)과는 별개로 센서 자체가 보고하는 상태다.

### 4.2 엣지 → 미들웨어: 로봇 상태 (FR-04, FR-06)

```json
{
  "type": "robot_status",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "robot-01",
  "position": { "x": 1.2, "y": 3.4, "frame": "farm_local" },
  "speed": 0.5,
  "battery_pct": 82,
  "charging": false,
  "mission_state": "working",
  "current_task_id": "pt-20260721-004",
  "error": null,
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

`mission_state`는 `idle` \| `moving` \| `working` \| `charging` \| `error`. `charging`·`mission_state`는 디자인이 표시하는 "자동 충전 중 · 완충 예상 42분", "작업 중 · A동 → WS2"를 위해 필요하다. `position.frame`은 §6 좌표계 참고.

### 4.3 미들웨어 → 엣지: 파레트 작업 임무 (FR-03, FR-19~26)

```json
{
  "type": "pallet_task",
  "version": "0.2",
  "command_id": "cmd-8f2a1c",
  "farm_id": "seongju",
  "pallet_id": "pallet-07",
  "from_slot": "rack-a-03",
  "station_id": "nutrient-station-01",
  "task_type": "nutrient",
  "params": { "amount_ml": 250, "ec": 1.8 },
  "issued_by": "user-42",
  "timeout_sec": 600,
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

### 4.4 미들웨어 → 엣지: 생육기 환경 제어 명령 (FR-10, FR-11)

```json
{
  "type": "control_command",
  "version": "0.2",
  "command_id": "cmd-3b91d7",
  "farm_id": "seongju",
  "device_id": "growbed-01",
  "command": "set_temperature",
  "params": { "target": 23.0 },
  "issued_by": "user-42",
  "timeout_sec": 30,
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

`command`는 온도·습도·양분·조도(LED) 대상으로 한정한다. **환기·차광·천창 명령은 정의하지 않는다** — 개발 범위 밖이다 (FR-10). FR-11 자동 모드는 `set_auto_mode` + `params.growth_stage` 형태의 모드 전환 명령이라 형태가 다르다.

### 4.5 미들웨어 → 엣지: 센서 영점 보정 (FR-39)

```json
{
  "type": "calibrate",
  "version": "0.2",
  "command_id": "cmd-c40e55",
  "farm_id": "seongju",
  "device_id": "growbed-01",
  "sensor_id": "temp-a",
  "mode": "zero_offset",
  "issued_by": "user-42",
  "timeout_sec": 60,
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

### 4.6 미들웨어 → 엣지: 원격 전체 정지 / 해제 (FR-35)

```json
{
  "type": "remote_stop",
  "version": "0.2",
  "command_id": "cmd-e17b90",
  "scope": "farm",
  "farm_id": "seongju",
  "stop_category": 2,
  "reason": "관리자 요청",
  "issued_by": "user-42",
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

해제는 `"type": "remote_stop_release"`로 동일 구조를 쓴다. `scope`는 `all` \| `farm`. 발행 토픽은 대상 농장의 **엣지 컨트롤러 command 토픽**(`farmon/v1/{farm}/edge/{edge_id}/command`)이다 — 전 장치 정지의 실행 주체가 엣지이기 때문이다 (증분 7 확정).

명령 토픽은 retain 하지 않으므로(§3) **이 메시지만으로는 재접속한 엣지가 정지 중임을 알 수 없다.** 지속되는 사실은 아래 `remote_stop_state`가 나른다.

#### 4.6.1 미들웨어 → 엣지: 원격 정지 상태 (retained)

```json
{
  "type": "remote_stop_state",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "edge-01",
  "engaged": true,
  "scope": "farm",
  "reason": "관리자 요청",
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

토픽 `farmon/v1/{farm}/edge/{edge_id}/stop_state`, **QoS 1 · retained**.

§4.6이 "지금 정지하라"는 **행위**라면, 이것은 "이 농장은 정지 상태다"라는 **사실**이다. 발동·해제 시마다 발행하며 엣지는 ack 하지 않는다 — 명령이 아니라 상태이기 때문이다.

retained 이므로 엣지가 재부팅해 구독하는 순간 브로커가 현재 상태를 즉시 준다. 이것이 없으면 정지 발동 중에 엣지를 재기동했을 때 **정지가 조용히 풀린다.** `estop_state`(§4.7)와 대칭이다 — 물리 비상정지는 엣지→서버 방향의 retained 상태, 원격 정지는 서버→엣지 방향의 retained 상태.

낡음 검사(§4.0)를 적용하지 않는다. 오래된 정지도 해제되지 않았으면 여전히 유효하고, 만료시키면 안전 반대 방향으로 실패한다.

> **이 메시지는 안전 기능이 아니다.** IEC 60204-1 Stop Category 2(제어된 정지, 전원 유지)에 해당하는 운전 정지이며, MQTT가 안전등급 통신이 아니므로 안전 기능을 이 경로에 의존시키지 않는다. 실제 비상정지는 현장 물리 장치가 담당한다 (`../01-requirements/non-functional.md` §2).

### 4.7 엣지 → 미들웨어: 물리 비상정지 상태 (FR-36)

```json
{
  "type": "estop_state",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "edge-01",
  "engaged": true,
  "source": "field_device",
  "timestamp": "2026-07-21T10:00:00+09:00"
}
```

**표시 전용이다.** 미들웨어·웹앱에서 이 상태를 해제하는 역방향 메시지를 정의하지 않는다 — 물리 비상정지는 현장에서 의도적인 수동 조작으로만 리셋된다. **엣지가 이 상태를 발행해 주기로 확정되었다** (OPN-19 해소). retained=true로 발행해 서버 재시작 후에도 마지막 상태를 복구할 수 있게 한다. 발행 토픽은 엣지 컨트롤러의 **status 토픽**(`farmon/v1/{farm}/edge/{edge_id}/status`)이다 (증분 7 확정). 해제는 같은 토픽에 `engaged: false` 발행으로 전달된다.

### 4.8 엣지 → 미들웨어: 명령 응답 (ACK)

```json
{
  "type": "ack",
  "version": "0.2",
  "command_id": "cmd-8f2a1c",
  "farm_id": "seongju",
  "device_id": "robot-01",
  "result": "accepted",
  "detail": null,
  "timestamp": "2026-07-21T10:00:01+09:00"
}
```

`result`는 `accepted` \| `rejected` \| `completed` \| `failed`. 명령을 **접수한 것**과 **실행 완료한 것**을 구분하며, 웹앱도 이를 구분해 표시한다. `timeout_sec` 내 `accepted`가 오지 않으면 실패로 처리한다.

### 4.9 장치 → 미들웨어: birth / death / heartbeat (FR-37)

```json
{
  "type": "birth",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "growbed-01",
  "device_type": "growbed",
  "metrics": [
    { "sensor_id": "temp-a",  "sensor_type": "temperature", "unit": "celsius", "initial": 24.5 },
    { "sensor_id": "hum-a",   "sensor_type": "humidity",    "unit": "percent", "initial": 58 }
  ],
  "publish_interval_sec": 10,
  "timestamp": "2026-07-21T09:59:50+09:00"
}
```

**장치가 자신의 데이터 항목을 스스로 선언한다.** 미들웨어 서버는 birth의 `metrics`를 근거로 수집 대상을 구성하므로, 항목이 늘어도 서버 코드나 설정 파일을 고치지 않는다. "데이터 타입·크기·주기가 확정되지 않았다"는 전제를 이 방식으로 흡수한다 (`../01-requirements/non-functional.md` §1).

`death`는 LWT로 등록해 두고, 브로커가 keep-alive 만료를 감지하면 대신 발행한다.

```json
{
  "type": "death",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "growbed-01",
  "timestamp": "2026-07-21T10:05:00+09:00"
}
```

**heartbeat** — 주기 데이터가 없는 장치(엣지 컨트롤러 등)의 생존 신호다. birth 에 선언한 `interval_sec` 마다 발행하고, 미들웨어는 수신 시각으로 online 을 유지한다(§5의 "마지막 수신"에 포함). 공백이 주기 배수를 넘으면 degraded/offline 로 판정하며, LWT death 즉시-offline 과 이중 방어를 이룬다. birth 가 유실돼도 다음 하트비트에 online 이 자가 복구된다. retain 하지 않는다(순간값).

```json
{
  "type": "heartbeat",
  "version": "0.2",
  "farm_id": "seongju",
  "device_id": "edge-01",
  "interval_sec": 10,
  "timestamp": "2026-07-21T10:00:05+09:00"
}
```

### 4.9.1 엣지 → 미들웨어: 농장 배치도 (FR-41, retained)

```json
{
  "type": "layout",
  "version": "0.2",
  "farm_id": "gyeongsan1",
  "device_id": "edge-01",
  "frame": "map",
  "zones": [
    { "id": "z0", "zone_type": "charging", "speed": 0.4,
      "polygon": [[3.9, 1.2], [6.8, 1.2], [6.8, 3.2], [3.9, 3.2]] }
  ],
  "points": [
    { "id": "slot-01", "point_type": "rack", "x": 2.45, "y": 0.0 },
    { "id": "station-01", "point_type": "station", "x": -1.05, "y": 9.2 },
    { "id": "home", "point_type": "charging", "x": 5.35, "y": 2.2 }
  ],
  "timestamp": "2026-08-10T09:00:00+09:00"
}
```

토픽 `farmon/v1/{farm_id}/edge/{edge_id}/layout`, **QoS 1 · retained**, 접속 시 1회.

birth(§4.9)가 "내가 어떤 데이터를 내는지"를 자기기술하듯, 이것은 **"내 농장이 어떻게 생겼는지"를 자기기술한다.** 엣지가 진실의 원천이므로 현장 도면이 바뀌면 서버가 따라간다.

`frame`은 좌표계 식별자이며 `robot_status.position.frame`과 **반드시 같아야 한다** — 다르면 배치도 위에 로봇을 겹쳐 그릴 수 없다. 단위는 m, 축은 ROS 표준(REP-103).

**미들웨어는 이 메시지를 반드시 DB에 적재한다.** retained 는 브로커가 살아 있을 때의 이야기이고, 배치도는 엣지가 꺼져 있어도 화면에 떠야 한다 (§5 오프라인 표시).

#### 좌표계 (OPN-21 해소)

실내 농장이므로 위경도는 쓰지 않는다. `farm.latitude/longitude`는 **농장의 소재지**(기상 조회·농장 목록)이고, 배치도와 로봇 위치는 **농장 내부 미터 좌표**다. 두 층위는 섞이지 않는다.

| 항목 | 값 |
|---|---|
| 원점 | 엣지 지도(SD map) 작성 기준점 — 서버는 변환하지 않는다 |
| 축 | ROS 표준 REP-103 (x 전방, y 좌측) |
| 단위 | m |
| 스케일 | 1:1. 화면 맞춤은 렌더러가 viewBox 로만 처리한다 |
| 프레임 식별자 | `frame` 필드 (현재 `map`) |

렌더러는 y축만 뒤집으면 된다 (ROS 는 y 위쪽 양수, SVG 는 아래쪽 양수).

### 4.10 애플리케이션 서버 → 웹앱: 실시간 푸시 (FR-04, FR-08, FR-32 등)

```json
{
  "channel": "seongju/environment",
  "data": { "temperature": 24.5, "humidity": 60.2 },
  "connection_state": "online",
  "last_received_at": "2026-07-21T10:00:00+09:00",
  "timestamp": "2026-07-21T10:00:02+09:00"
}
```

`connection_state`·`last_received_at`을 함께 내려, 데이터가 최신이 아닐 때 웹앱이 이를 표시할 수 있게 한다 (페일세이프 ③계층).

## 5. 통신 상태 판정 (FR-37)

| 상태 | 판정 근거 |
|---|---|
| `online` | birth 수신 후, 마지막 수신(telemetry·status·**heartbeat** 포함)이 발행 주기의 3배 이내 |
| `degraded` | 마지막 수신이 발행 주기의 3배 초과, death 미수신 |
| `offline` | death 수신 (LWT 발행 포함) 또는 마지막 수신이 발행 주기의 10배 초과 |

배수 값은 잠정치이며 실측 후 조정한다 (OPN-04와 함께 검토). `degraded`·`offline` 전이 시 알림을 생성한다 (FR-32).

## 6. 좌표계 (FR-41)

배치도 렌더링과 로봇 위치 표시에 필요하다. **아직 정의되지 않았다 (OPN-21).** 확정해야 할 항목:

- 원점 위치 (농장 도면 기준점)
- 축 방향 (x·y 양의 방향)
- 단위 (m 기준 권장)
- 스케일 (도면 픽셀 ↔ 실거리)
- 프레임 식별자 — 메시지의 `position.frame`에 명시해 이후 다중 좌표계 도입에 대비한다

협의 전까지는 논리 배치(구역·슬롯 단위)로 표현하고 실좌표 렌더링은 보류한다.

## 7. 내부 REST API 개요

미들웨어 서버가 애플리케이션 서버에만 노출하는 API다 (외부 공개 없음). 실시간 데이터는 내부 MQTT로 흐르므로, REST는 이력 조회·설정·명령 요청을 담당한다.

| 용도 | 예시 |
|---|---|
| 이력 조회 | 센서 이력, 로봇 작업 로그, 알림 목록, 정지 이력 |
| 집계 조회 | 통계(FR-14), 조건 조회(FR-15), 농업일지(FR-17) |
| 설정 | 작업 스케줄(FR-19), 양·농도(FR-21~26), 알림 규칙(FR-34), 장비 등록(FR-07·13) |
| 명령 요청 | 제어 명령·임무 등록·영점 보정·원격 전체 정지 — 미들웨어가 MQTT 명령으로 변환해 발행 |

엔드포인트 목록은 데이터 모델 필드 확정 후 작성한다 (OPN-09).

## 8. 확정 필요 항목

(`../../README.md` 참고)

- 메시지 스키마 필드 리뷰 — OPN-10
- 외부 기상 API 공급자 선정 — OPN-17
- 배치도 좌표계 정의 — OPN-21 (엣지팀 협의 진행 중)
- MQTT 브로커 배치·인증·TLS·ACL 정책 — OPN-22 (브로커 소프트웨어는 Mosquitto 확정 — `tech-stack.md`)

## 참고

- Eclipse Sparkplug 규격 — 토픽 네임스페이스 계층과 birth/death certificate 방식을 참고했다. 본 규격은 Sparkplug를 그대로 채택하지 않고(페이로드는 protobuf가 아닌 JSON) 구조만 차용한다.

## 변경 이력
- 2026-07-07 · 최초 작성
- 2026-07-31 · `heartbeat` 메시지 신설(GEN-1225) — 주기 발행이 없는 엣지 컨트롤러의 생존 신호. §2 message_type·§3 정책·§4.9·§5 판정 반영. birth 유실 시 online 자가 복구, LWT 와 이중 방어
- 2026-07-30 · 구현(증분 2~7)에서 확정된 계약 반영 — LWT death 정리 계약(§3), remote_stop·estop_state 발행 토픽 명시(§4.6·4.7)
- 2026-07-29 · MQTT 확정에 따른 전면 개편. 토픽 네임스페이스(§2), QoS·retained·LWT 정책(§3), 통신 상태 판정(§5), 좌표계(§6), 내부 REST 개요(§7) 신설. 스키마 0.1→0.2 — `sensor_id`·`farm_id`·`command_id`·`timeout_sec` 추가, robot_status에 충전·임무 상태 추가, 신규 메시지 5종(calibrate, remote_stop/release, estop_state, ack, birth/death) 정의
