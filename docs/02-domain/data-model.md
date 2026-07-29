# 02-1 · 데이터 모델 (초안)

기능 요구사항에서 다루는 데이터를 엔터티 후보로 정리한다. 필드·타입은 DB 기술 스택 확정 후 정의한다 (OPN-03, OPN-09).

양액·급수·방재는 파이프 배관이 아니라 로봇이 트레이(파레트)를 랙에서 반출해 작업 장소로 옮기는 방식이므로, 이 흐름을 표현하는 Pallet·RackSlot·WorkStation·PalletTask 엔터티를 둔다.

## 0. 공통 원칙

- **모든 엔터티는 농장 식별자(`farm_id`)를 갖는다.** 2차년도 실운영은 농장 1개이지만 설계는 N개를 전제로 한다 (`../01-requirements/non-functional.md` §1). 농장 추가 시 스키마를 바꾸지 않는 것이 목적이다. 아래 표에서 `farm_id`는 개별 언급을 생략한다.
- **원시 데이터와 사용자 입력 데이터의 저장 위치가 다르다.** 엣지에서 온 원시·집계 데이터는 미들웨어 서버, 계정·세션·메모는 애플리케이션 서버가 보관한다 (`../03-architecture/component-internals.md`). 물리적으로 분리할지 스키마만 나눌지는 미정 (OPN-15).
- **시계열 엔터티는 발생 시각과 수신 시각을 함께 보존한다.** 시간 동기화 기준은 엣지 발생 시각(`timestamp`)이고, 수신 시각은 지연 판정에 쓴다 (FR-16).

## 1. 엔터티 후보

### 1.1 조직·장비

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| Farm | 스마트팜(농장). 이름·유형(온실/식물공장/노지)·작물·소재 지역(기상 조회용) | FR-38, FR-40 |
| DeviceMeta | 장비 등록 정보. 대상은 **로봇·생육기·탱크·워크스테이션·센서** 전체. 유형·이름·설치 위치·소속 농장·등록/삭제 상태 | FR-07, FR-13 |
| Sensor | 센서 개체. 식별자·유형·설치 위치·소속 생육기·현재값·상태(온라인/응답지연/오프라인)·마지막 수신 시각 | FR-08, FR-39, FR-37 |
| SensorCalibration | 센서 영점 보정 이력. 대상 센서·시각·수행자·보정 전/후 값 | FR-39 |
| Tank | 탱크. 유형(양액/급수/방재액/세정액)·**용량**·현재 수위·**소비율**. 용량과 소비율이 있어야 잔량을 "약 320L · 2일분"처럼 환산할 수 있다 | FR-08, FR-21~26 |
| DeviceConnectionState | 장치별 통신 상태. 온라인 여부·마지막 birth/death 시각·마지막 수신 시각 | FR-37 |

### 1.2 로봇·작업

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| RobotTaskLog | 로봇 작업 이력 (성공여부·작업량·**재시도 횟수**, 수확 제외) | FR-01 |
| RobotStatus | 로봇 상태 (위치·속도·전원·이상·**충전 중 여부**·**현재 임무 진행 상태**, 실시간 스냅샷) | FR-04, FR-06 |
| RobotSchedule | 로봇 임무·경로 스케줄 | FR-03 |
| RobotVideoAsset | 로봇 영상 데이터 (메타데이터, 원본은 별도 스토리지 참조) | FR-05, FR-09 |
| Pallet | 재배 트레이(파레트). 현재 위치(랙 슬롯/이동중/작업장소) 상태 포함 | FR-03, FR-19~26 |
| RackSlot | 파레트가 보관되는 랙의 슬롯 위치 | FR-03 |
| WorkStation | 양액·급수·방재 작업이 실제 수행되는 장소 (3차년도부터 수확 작업도 포함) | FR-03, FR-21~26 |
| PalletTask | 파레트 반출→작업장소 이동→작업 수행→반납의 임무 실행 기록. 작업유형(양액/급수/방재)·파라미터(양·농도) 포함 | FR-03, FR-19~26 |

### 1.3 환경·생육

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| EnvironmentReading | 환경/설비 센서값 (온도·습도·양분·조도·전력·탱크 수위 등), 시계열. 발행 주체는 개별 `Sensor` | FR-08 |
| GrowthAnalysis | 생육상태 분석 결과 (성장률·병충해유무·수확시기) | FR-09 |
| DeviceControlSetting | 생육기 환경(온도·습도·양분·조도/LED) 제어 설정값 (수동/자동 구분, 성장단계) | FR-10, FR-11, FR-12 |
| WeatherReading | 외부 기상 정보 (기온·날씨·습도·강수·풍속·일사량). **엣지가 아닌 외부 API에서 취득** | FR-40 |

### 1.4 데이터 관리

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| DataStatistics | 기간별 집계 결과 (시간/일/주/월 × 전체/농장/생육기) | FR-14 |
| FarmLog | 자동 생성 리포트(일간/주간/월간/**년간**) + 관리자 메모(사진/동영상 첨부) | FR-17, FR-18 |
| TaskSchedule | 생육기별 작업 스케줄 (양액·급수·방재 등, "언제 할지"만 정의) | FR-19, FR-20 |
| VoiceLog | 음성 메모·음성 명령 기록 (시각·내용·인식 결과) | FR-27, FR-28, FR-29 |

### 1.5 알림 (신설)

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| Alert | 알림. 심각도(경고/주의/완료)·종류·대상 장비·발생 시각·본문·확인 여부·확인 시각·**딥링크 대상**(관련 화면·엔터티) | FR-32, FR-33 |
| AlertRule | 알림 규칙. 농장별·종류별 수신 여부, 센서 항목별 상·하한 임계값 | FR-34 |

### 1.6 안전 (신설)

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| StopEvent | 정지 이력. **구분(원격 전체 정지 / 물리 비상정지)**·발동·해제 시각·대상 범위(전체/농장)·발동자·사유. 물리 비상정지는 발동자가 없고 해제도 현장 조작이므로 발동자·해제자 필드가 비어 있을 수 있다 | FR-35, FR-36 |

두 정지는 성격이 전혀 다르지만(안전등급 여부, 해제 주체) 이력 조회는 함께 보는 것이 유용하므로 한 엔터티에 구분 필드로 담는다. 상세는 `../01-requirements/non-functional.md` §2 참고.

### 1.7 배치도 (신설)

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| FarmLayout | 농장 도면. 좌표계 정의(원점·축 방향·단위·스케일)와 배경 도형 | FR-41 |
| LayoutElement | 도면 위 요소의 배치. 대상 엔터티 참조(랙/워크스테이션/탱크/센서)와 좌표 | FR-41 |

좌표계 정의는 엣지팀 협의가 필요하다 (OPN-21). 협의 전까지는 논리 배치(구역·슬롯 단위)로만 표현한다. 로봇 위치는 정적 배치가 아니라 `RobotStatus`의 실시간 좌표를 쓴다.

### 1.8 계정

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| User | 계정·권한(역할)·2단계 인증 설정·원격 접근 허용 여부 | 전체, FR-31 |

## 2. 관계 개요

```
Farm ──┬── DeviceMeta ──┬── (로봇)    ──┬── RobotStatus
       │                │              ├── RobotTaskLog
       │                │              ├── RobotSchedule
       │                │              ├── RobotVideoAsset
       │                │              └── PalletTask (수행 로봇)
       │                │
       │                ├── (생육기)  ──┬── Sensor ──┬── EnvironmentReading
       │                │              │            └── SensorCalibration
       │                │              └── DeviceControlSetting
       │                │
       │                ├── (탱크)      ── Tank
       │                ├── (워크스테이션) ── WorkStation
       │                └── (전체) ────── DeviceConnectionState
       │
       ├── RackSlot ──1:1── Pallet ──┬── PalletTask (반출·작업·반납 이력)
       │                            └── WorkStation (PalletTask를 통해 방문)
       │
       ├── FarmLayout ── LayoutElement ──> (RackSlot / WorkStation / Tank / Sensor)
       ├── WeatherReading            (외부 API, 농장 소재 지역 기준)
       ├── TaskSchedule
       ├── GrowthAnalysis
       ├── Alert ──> (딥링크 대상 엔터티)
       ├── AlertRule
       └── StopEvent

User ──┬── FarmLog (작성)
       ├── VoiceLog (작성)
       ├── PalletTask / DeviceControlSetting (제어 요청)
       ├── Alert (확인 처리)
       ├── SensorCalibration (수행)
       └── StopEvent (원격 전체 정지 발동·해제)

EnvironmentReading, RobotStatus ──> DataStatistics (집계)
DataStatistics ──> FarmLog (자동 생성 리포트)

EnvironmentReading, DeviceConnectionState, Tank ──> Alert (AlertRule 대조로 생성)
```

## 3. 확정 필요 항목

(`../../README.md` 참고)

- ~~DB 기술 스택~~ — **OPN-03 해소: PostgreSQL 16 + TimescaleDB 확장** (`../03-architecture/tech-stack.md`). `EnvironmentReading`·`RobotStatus` 등 고빈도 시계열 테이블만 하이퍼테이블화한다
- 각 엔터티의 정확한 필드·타입 정의 — OPN-09. 통신 규격(MQTT 스키마 0.2)이 확정되었으므로 착수 가능하다
- 애플리케이션 서버 자체 저장소와 미들웨어 서버 DB의 분리 수준 — OPN-15
- 배치도 좌표계 원점·축·단위·스케일 — OPN-21
- 알림 임계값 기본값 (`AlertRule` 초기값) — OPN-20

## 변경 이력
- 2026-07-07 · 최초 작성
- 2026-07-29 · 엔터티를 성격별로 재분류. 신규 12종 추가 — Farm, Sensor, SensorCalibration, Tank, DeviceConnectionState, WeatherReading, Alert, AlertRule, StopEvent, FarmLayout, LayoutElement. 기존 보강 — 전 엔터티 `farm_id`, DeviceMeta 대상 확대, RobotTaskLog 재시도 횟수, RobotStatus 충전·임무 상태, FarmLog 년간 리포트. 관계 개요를 Farm 루트로 재작성
