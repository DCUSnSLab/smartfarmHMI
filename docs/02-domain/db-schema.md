# 02-2 · DB 스키마 정의

`data-model.md`의 엔터티 28종에 필드·타입·제약을 부여한다 (OPN-09 해소). PostgreSQL 16 + TimescaleDB 전제 (`../03-architecture/tech-stack.md`).

본 문서는 마이그레이션 작성(개발 증분 1)의 기준이며, 실제 DDL은 마이그레이션 도구가 생성한다. 여기서 확정하는 것은 **테이블·컬럼·타입·제약·인덱스·소유권**이다.

## 1. 스키마 분리·소유권 규칙

같은 PostgreSQL 인스턴스에 스키마 2개를 둔다 (OPN-15 확정 — 물리 분리는 부하 확인 후 재판단).

| 스키마 | 소유 서비스 | 마이그레이션 도구 | 내용 |
|---|---|---|---|
| `app` | 애플리케이션 서버 (Django) | Django migrations | 계정·세션·관리자 메모·첨부·음성 기록 — 사용자 직접 입력 |
| `mw` | 미들웨어 서버 (FastAPI) | Alembic | 조직·장비 레지스트리, 원시 시계열, 임무·알림·정지·집계 — 엣지 유래·처리 데이터 |

**소유권 = 마이그레이션 권한 = 접근 권한이다.**

- `app` 스키마는 Django만, `mw` 스키마는 Alembic만 변경한다.
- **상대 스키마에 대한 직접 접근(읽기 포함)을 금지한다.** 애플리케이션 서버가 `mw` 데이터를 원하면 미들웨어 내부 REST/내부 토픽을 경유한다 — 설계 원칙 #2의 DB 버전. DB 계정도 서비스별로 분리해 상대 스키마 권한을 부여하지 않는다 (`app_user`, `mw_user`).
- Django 프레임워크 테이블(django_migrations, django_session, auth_* 등)은 `app` 스키마에 생성되며 본 문서의 명세 대상이 아니다.

## 2. 공통 규약

| 항목 | 규약 |
|---|---|
| PK | `id BIGINT GENERATED ALWAYS AS IDENTITY` (예외: 하이퍼테이블·명시된 자연키) |
| 시각 | `TIMESTAMPTZ`. 시계열은 `ts`(엣지 발생 시각) + `received_at`(미들웨어 수신 시각) 병행 — FR-16 |
| 감사 | 레지스트리성 테이블은 `created_at`/`updated_at` `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| enum | 초기에는 `TEXT` + `CHECK` 제약. 값 집합이 안정되면 PostgreSQL enum 전환 검토 |
| 확장 필드 | `extra JSONB NOT NULL DEFAULT '{}'` — 통신 규격의 자유 형식 `payload`/`params`에 대응. 확정 필드로 승격되기 전의 항목을 담는다 |
| 식별자 | 엣지·MQTT와 공유하는 식별자(`farm_id`, `device_id`, `sensor_id` 등)는 `TEXT` 자연키를 그대로 저장 (토픽 경로와 1:1) |
| 소프트 삭제 | 장비 레지스트리는 `deleted_at TIMESTAMPTZ NULL` — FR-07·13 "삭제 시 과거 데이터 보존, 관리 대상 제외" |
| FK | 레지스트리·이력 테이블 간에는 FK를 건다. **하이퍼테이블에는 FK를 걸지 않는다** (적재 성능·파티션 제약, §5) — 정합성은 수집기에서 birth 등록 여부로 검증 |

## 3. `mw` 스키마

### 3.1 조직·장비

**farm** — 농장 (FR-38·40)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| farm_id | TEXT | **PK** (자연키, 토픽 경로 사용 — 예: `seongju`) |
| name | TEXT | NOT NULL |
| farm_type | TEXT | NOT NULL, CHECK (`greenhouse`\|`plant_factory`\|`open_field`) |
| crop | TEXT | NULL |
| region_code | TEXT | NULL — 호환용 지역 코드(현재 미사용) |
| latitude | DOUBLE PRECISION | NULL — WGS84 위도 |
| longitude | DOUBLE PRECISION | NULL — WGS84 경도 |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**device_meta** — 장비 레지스트리 (FR-07·13). 대상: 로봇·생육기·탱크·워크스테이션·센서 전체

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 토픽 경로 식별자. **UNIQUE(farm_id, device_id)** |
| device_type | TEXT | NOT NULL, CHECK (`robot`\|`growbed`\|`tank`\|`station`\|`sensor`\|`edge`) |
| name | TEXT | NOT NULL |
| model | TEXT | NULL |
| location | TEXT | NULL — 설치·배치 위치 서술 |
| registered_by | TEXT | NULL — app.user 참조값(약결합: FK 없음, 스키마 경계) |
| deleted_at | TIMESTAMPTZ | NULL (소프트 삭제) |
| extra | JSONB | NOT NULL DEFAULT '{}' |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**sensor** — 센서 개체 (FR-39). device_meta(device_type=`sensor`)의 상세 확장

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| device_meta_id | BIGINT | NOT NULL UNIQUE, FK→device_meta |
| farm_id | TEXT | NOT NULL, FK→farm |
| sensor_id | TEXT | NOT NULL — MQTT `sensor_id`. **UNIQUE(farm_id, sensor_id)** |
| parent_device_id | TEXT | NULL — 소속 생육기의 device_id (공간 분산 배치 표현) |
| sensor_type | TEXT | NOT NULL, CHECK (`temperature`\|`humidity`\|`ec`\|`co2`\|`illuminance`\|`soil`\|`power`\|`water_level`) — birth 선언으로 신값 추가 가능하므로 CHECK는 수집기 레벨 검증으로 대체 가능(증분 2에서 결정) |
| unit | TEXT | NOT NULL |
| location | TEXT | NULL |
| last_value | DOUBLE PRECISION | NULL — 최신값 캐시(대시보드 조회용, 원본은 environment_reading) |
| last_ts | TIMESTAMPTZ | NULL |
| sensor_state | TEXT | NOT NULL DEFAULT 'ok', CHECK (`ok`\|`degraded`\|`fault`) — 센서 자가 보고 상태 |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**sensor_calibration** — 영점 보정 이력 (FR-39)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| sensor_id_ref | BIGINT | NOT NULL, FK→sensor |
| command_id | TEXT | NULL, FK→command_log(command_id) — 보정 명령 추적 |
| mode | TEXT | NOT NULL DEFAULT 'zero_offset' |
| before_value / after_value | DOUBLE PRECISION | NULL |
| performed_by | TEXT | NULL — app.user 참조값 |
| performed_at | TIMESTAMPTZ | NOT NULL |

**tank** — 탱크 (FR-08·21~26). device_meta(device_type=`tank`)의 상세 확장

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| device_meta_id | BIGINT | NOT NULL UNIQUE, FK→device_meta |
| farm_id | TEXT | NOT NULL, FK→farm |
| tank_type | TEXT | NOT NULL, CHECK (`nutrient`\|`water`\|`pesticide`\|`cleaning`) |
| capacity_l | DOUBLE PRECISION | NOT NULL — 용량 |
| current_level_pct | DOUBLE PRECISION | NULL — 최신 수위 캐시 |
| consumption_rate | DOUBLE PRECISION | NULL — 소비율 (L/일 또는 L/회) |
| consumption_unit | TEXT | NULL, CHECK (`per_day`\|`per_task`) |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

수위 원시 시계열은 `environment_reading`(sensor_type=`water_level`)에 적재되고, 여기는 환산 표시("약 320L · 2일분")에 필요한 정적 속성 + 최신값 캐시만 둔다.

**device_connection_state** — 통신 상태 (FR-37)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL. **UNIQUE(farm_id, device_id)** |
| device_type | TEXT | NULL — birth 자기기술 보존. 정지 명령의 엣지 식별에 사용 (마이그레이션 0002) |
| state | TEXT | NOT NULL, CHECK (`online`\|`degraded`\|`offline`) |
| last_birth_at / last_death_at | TIMESTAMPTZ | NULL |
| last_received_at | TIMESTAMPTZ | NULL |
| birth_metrics | JSONB | NULL — birth의 `metrics` 선언 원문 보존 |
| publish_interval_sec | INTEGER | NULL — 판정 배수 계산 기준 (통신 규격 §5) |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### 3.2 로봇·작업

**robot_status** — 로봇 상태 실시간 스냅샷 (FR-04·06) — **하이퍼테이블**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| ts | TIMESTAMPTZ | NOT NULL — 파티션 키 |
| received_at | TIMESTAMPTZ | NOT NULL |
| farm_id | TEXT | NOT NULL |
| device_id | TEXT | NOT NULL |
| pos_x / pos_y | DOUBLE PRECISION | NULL |
| pos_frame | TEXT | NULL — 좌표계 식별 (OPN-21) |
| speed | DOUBLE PRECISION | NULL |
| battery_pct | SMALLINT | NULL, CHECK 0~100 |
| charging | BOOLEAN | NOT NULL DEFAULT false |
| mission_state | TEXT | NOT NULL DEFAULT 'idle', CHECK (`idle`\|`moving`\|`working`\|`charging`\|`error`) |
| current_task_id | TEXT | NULL — pallet_task.task_id 참조값 (FK 없음) |
| error | JSONB | NULL |
| extra | JSONB | NOT NULL DEFAULT '{}' |

**robot_task_log** — 작업 이력 (FR-01)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL |
| task_kind | TEXT | NOT NULL — 적엽·반출·이동·반납 등 (수확 제외, 3차년도) |
| result | TEXT | NOT NULL, CHECK (`success`\|`failure`) |
| retry_count | SMALLINT | NOT NULL DEFAULT 0 |
| quantity | DOUBLE PRECISION | NULL — 작업량 |
| quantity_unit | TEXT | NULL |
| pallet_task_id | BIGINT | NULL, FK→pallet_task |
| started_at / finished_at | TIMESTAMPTZ | NULL / NOT NULL |
| received_at | TIMESTAMPTZ | NOT NULL |
| extra | JSONB | NOT NULL DEFAULT '{}' |

**robot_schedule** — 로봇 임무 스케줄 (FR-03)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 대상 로봇 |
| task_type | TEXT | NOT NULL, CHECK (`nutrient`\|`water`\|`pesticide`\|`prune`\|`transport`) |
| pallet_id | TEXT | NULL |
| from_slot / station_id / return_slot | TEXT | NULL — 반출·작업·반납 위치 |
| start_at | TIMESTAMPTZ | NOT NULL |
| duration_min | INTEGER | NOT NULL |
| status | TEXT | NOT NULL DEFAULT 'scheduled', CHECK (`scheduled`\|`dispatched`\|`done`\|`canceled`\|`failed`) |
| created_by | TEXT | NULL |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

충돌 검사(FR-03: 로봇·워크스테이션·파레트 3자원)는 이 테이블 + pallet_task 진행분에 대한 시간 겹침 질의로 구현한다. 인덱스: `(farm_id, device_id, start_at)`, `(farm_id, station_id, start_at)`, `(farm_id, pallet_id, start_at)`.

**robot_video_asset** — 영상 메타 (FR-05·09)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 촬영 로봇 |
| storage_key | TEXT | NOT NULL — MinIO 객체 키 (원본은 오브젝트 스토리지) |
| captured_at | TIMESTAMPTZ | NOT NULL |
| duration_sec | INTEGER | NULL |
| target_device_id | TEXT | NULL — 촬영 대상 생육기 |
| purpose | TEXT | NULL, CHECK (`growth`\|`pest`\|`general`) |
| received_at | TIMESTAMPTZ | NOT NULL |
| extra | JSONB | NOT NULL DEFAULT '{}' |

**pallet / rack_slot / work_station / pallet_task** — 트레이 반출 흐름 (FR-03·19~26)

| 테이블 | 컬럼 요약 |
|---|---|
| rack_slot | id PK · farm_id FK · slot_id TEXT (UNIQUE with farm_id, 예 `rack-a-03`) · zone TEXT · created_at |
| pallet | id PK · farm_id FK · pallet_id TEXT (UNIQUE with farm_id) · home_slot_id BIGINT FK→rack_slot · state TEXT CHECK (`stored`\|`moving`\|`at_station`) · current_slot_id BIGINT NULL FK→rack_slot · current_station_id BIGINT NULL FK→work_station · crop_batch TEXT NULL · updated_at |
| work_station | id PK · farm_id FK · station_id TEXT (UNIQUE with farm_id) · station_type TEXT CHECK (`nutrient`\|`water`\|`pesticide`\|`cleaning`) · state TEXT CHECK (`idle`\|`busy`\|`fault`) · updated_at |
| pallet_task | 아래 상세 |

**pallet_task** — 임무 실행 기록

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| task_id | TEXT | NOT NULL UNIQUE — MQTT 발행 시 식별자 (`pt-...`) |
| command_id | TEXT | NULL, FK→command_log(command_id) |
| farm_id | TEXT | NOT NULL, FK→farm |
| pallet_id | BIGINT | NOT NULL, FK→pallet |
| robot_device_id | TEXT | NULL — 배정 로봇 |
| from_slot_id | BIGINT | NOT NULL, FK→rack_slot |
| station_id | BIGINT | NOT NULL, FK→work_station |
| task_type | TEXT | NOT NULL, CHECK (`nutrient`\|`water`\|`pesticide`) |
| params | JSONB | NOT NULL DEFAULT '{}' — 양·농도 (`amount_ml`, `ec` 등) |
| status | TEXT | NOT NULL DEFAULT 'issued', CHECK (`issued`\|`accepted`\|`in_progress`\|`completed`\|`failed`\|`timeout`) |
| issued_by | TEXT | NULL |
| source_schedule_id | BIGINT | NULL, FK→task_schedule — 스케줄 유래 임무 추적 (FR-19·20) |
| issued_at / completed_at | TIMESTAMPTZ | NOT NULL / NULL |

### 3.3 환경·생육

**environment_reading** — 환경 센서값 (FR-08) — **하이퍼테이블**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| ts | TIMESTAMPTZ | NOT NULL — 파티션 키 |
| received_at | TIMESTAMPTZ | NOT NULL |
| farm_id | TEXT | NOT NULL |
| device_id | TEXT | NOT NULL — 소속 생육기 등 |
| sensor_id | TEXT | NOT NULL |
| sensor_type | TEXT | NOT NULL |
| value | DOUBLE PRECISION | NOT NULL |
| unit | TEXT | NOT NULL |
| sensor_state | TEXT | NOT NULL DEFAULT 'ok' |
| extra | JSONB | NOT NULL DEFAULT '{}' |

**growth_analysis** — 생육 분석 결과 (FR-09)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 대상 생육기 |
| video_asset_id | BIGINT | NULL, FK→robot_video_asset — 근거 영상 |
| growth_rate_pct | DOUBLE PRECISION | NULL — 주간 성장률 |
| pest_detected | BOOLEAN | NULL |
| harvest_eta | DATE | NULL |
| confidence | DOUBLE PRECISION | NULL, CHECK 0~1 |
| analyzed_at | TIMESTAMPTZ | NOT NULL |
| engine | TEXT | NULL — 외부 AI 식별 (연동 훅) |
| result | JSONB | NOT NULL DEFAULT '{}' — 원문 결과 보존 |

**device_control_setting** — 생육기 제어 설정 (FR-10·11·12)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 대상 생육기 |
| mode | TEXT | NOT NULL, CHECK (`manual`\|`auto`\|`ai`) |
| growth_stage | TEXT | NULL — auto 모드 성장단계 (FR-11) |
| ai_priority | TEXT | NULL, CHECK (`growth_first`\|`power_first`) — FR-12 |
| targets | JSONB | NOT NULL DEFAULT '{}' — `{temperature: 23.0, humidity: 60, ec: 1.8, led_pct: 70}` (제어 대상 4종 한정, FR-10) |
| is_current | BOOLEAN | NOT NULL DEFAULT true — 이력 보존: 변경 시 새 행 + 이전 행 false |
| set_by | TEXT | NULL |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

부분 UNIQUE 인덱스: `UNIQUE(farm_id, device_id) WHERE is_current`.

**weather_reading** — 외부 기상 (FR-40) — **하이퍼테이블**

| 컬럼 | 타입 | 제약 |
|---|---|---|
| ts | TIMESTAMPTZ | NOT NULL — 관측·예보 기준 시각, 파티션 키 |
| received_at | TIMESTAMPTZ | NOT NULL |
| farm_id | TEXT | NOT NULL |
| temperature_c / humidity_pct / precipitation_mm / wind_ms | DOUBLE PRECISION | NULL |
| condition | TEXT | NULL — 맑음·구름많음 등 |
| solar_level | TEXT | NULL — GHI 수평면 전일사량(W/m²) |
| provider | TEXT | NOT NULL — 공급자 식별 (OPN-17) |
| raw | JSONB | NOT NULL DEFAULT '{}' — 공급자 응답 원문 |

### 3.4 데이터 관리

**data_statistics** — 기간별 집계 (FR-14)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NULL, FK→farm — NULL이면 전체 농장 집계 |
| device_id | TEXT | NULL — NULL이면 농장 전체 (생육기 축은 OPN-16) |
| period | TEXT | NOT NULL, CHECK (`hour`\|`day`\|`week`\|`month`) |
| bucket_start | TIMESTAMPTZ | NOT NULL |
| metric | TEXT | NOT NULL — `avg_temperature`, `total_power` 등 |
| value | DOUBLE PRECISION | NOT NULL |
| computed_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

UNIQUE(farm_id, device_id, period, bucket_start, metric). TimescaleDB continuous aggregate로 대체 가능한 항목은 증분 9+에서 재검토.

**farm_report** — 자동 생성 리포트 (FR-17)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NULL, FK→farm — NULL이면 전 농장 리포트 |
| report_type | TEXT | NOT NULL, CHECK (`daily`\|`weekly`\|`monthly`\|`yearly`) |
| period_start / period_end | DATE | NOT NULL |
| body | TEXT | NOT NULL — 생성된 리포트 본문 |
| stats | JSONB | NOT NULL DEFAULT '{}' — 근거 수치 |
| generated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

UNIQUE(farm_id, report_type, period_start).

> `data-model.md`의 `FarmLog`(자동 리포트 + 관리자 메모)는 저장 위치 원칙에 따라 **`mw.farm_report`(자동 생성)와 `app.farm_memo`(사용자 입력)로 분리**된다. 농업일지 화면은 두 소스를 합성해 표시한다.

**task_schedule** — 작업 스케줄 (FR-19·20)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NULL — 대상 생육기 |
| task_type | TEXT | NOT NULL, CHECK (`nutrient`\|`water`\|`pesticide`) |
| times_of_day | TIME[] | NOT NULL — 1일 실행 시각 목록 (예: `{08:00,13:00,16:00}`) |
| mode | TEXT | NOT NULL DEFAULT 'manual', CHECK (`manual`\|`auto`) |
| params | JSONB | NOT NULL DEFAULT '{}' — 양·농도 기본값 (FR-21~26 설정과 병합) |
| is_active | BOOLEAN | NOT NULL DEFAULT true |
| created_by | TEXT | NULL |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

### 3.5 알림

**alert** (FR-32·33)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| severity | TEXT | NOT NULL, CHECK (`warning`\|`caution`\|`info`) — 경고/주의/완료 |
| alert_kind | TEXT | NOT NULL, CHECK (`threshold`\|`tank_low`\|`device_fault`\|`connection`\|`stop`\|`task_done`\|`task_failed`) |
| device_id | TEXT | NULL — 대상 장비 |
| title | TEXT | NOT NULL |
| body | TEXT | NULL |
| deeplink | TEXT | NULL — 관련 화면 라우트 (예: `/farms/seongju/supply`) |
| occurred_at | TIMESTAMPTZ | NOT NULL |
| acked_at | TIMESTAMPTZ | NULL — 읽음 처리 시각 |
| acked_by | TEXT | NULL |
| rule_id | BIGINT | NULL, FK→alert_rule |
| extra | JSONB | NOT NULL DEFAULT '{}' |

인덱스: `(farm_id, occurred_at DESC)`, 부분 인덱스 `WHERE acked_at IS NULL` (미확인 카운트).

**alert_rule** (FR-34)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| farm_id | TEXT | NOT NULL, FK→farm |
| alert_kind | TEXT | NOT NULL |
| sensor_type | TEXT | NULL — threshold 계열일 때 대상 항목 |
| min_value / max_value | DOUBLE PRECISION | NULL — 상·하한 (기본값은 OPN-20) |
| enabled | BOOLEAN | NOT NULL DEFAULT true |
| updated_by | TEXT | NULL |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

UNIQUE(farm_id, alert_kind, sensor_type).

### 3.6 안전

**stop_event** (FR-35·36)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| stop_kind | TEXT | NOT NULL, CHECK (`remote`\|`physical_estop`) — 원격 전체 정지 / 물리 비상정지 |
| scope | TEXT | NOT NULL, CHECK (`all`\|`farm`) |
| farm_id | TEXT | NULL, FK→farm — scope=`farm`일 때 |
| engaged_at | TIMESTAMPTZ | NOT NULL |
| released_at | TIMESTAMPTZ | NULL — 미해제 상태면 NULL |
| engaged_by / released_by | TEXT | NULL — physical_estop은 발동·해제 주체가 현장이므로 NULL 허용 |
| reason | TEXT | NULL |
| command_id | TEXT | NULL, FK→command_log(command_id) — remote일 때 |

부분 UNIQUE: `UNIQUE(stop_kind, scope, farm_id) WHERE released_at IS NULL` — 같은 범위의 미해제 정지 중복 방지.

### 3.7 배치도

**farm_layout / layout_element** (FR-41)

| 테이블 | 컬럼 요약 |
|---|---|
| farm_layout | id PK · farm_id FK UNIQUE · coord_frame TEXT NULL (OPN-21) · origin_desc TEXT NULL · scale JSONB NULL · background JSONB NULL · updated_at |
| layout_element | id PK · layout_id FK→farm_layout · element_type TEXT CHECK (`rack`\|`station`\|`tank`\|`sensor`\|`entrance`\|`zone`) · ref_device_id TEXT NULL (딥링크 대상) · x/y DOUBLE PRECISION NULL · zone TEXT NULL — 좌표 확정 전엔 zone 기반 논리 배치 |

### 3.8 명령 추적 (신규 — data-model에 추가 필요)

**command_log** — 발행 명령의 ACK·멱등성 추적 (통신 규격 §4.8, 비기능 §4)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| command_id | TEXT | **PK** (`cmd-...`) — 멱등성 키 |
| farm_id | TEXT | NOT NULL, FK→farm |
| device_id | TEXT | NOT NULL — 대상 장치 |
| command_type | TEXT | NOT NULL — `pallet_task`\|`control_command`\|`calibrate`\|`remote_stop`\|`remote_stop_release` 등 |
| payload | JSONB | NOT NULL — 발행 메시지 원문 |
| status | TEXT | NOT NULL DEFAULT 'issued', CHECK (`issued`\|`accepted`\|`rejected`\|`completed`\|`failed`\|`timeout`) |
| issued_by | TEXT | NULL |
| issued_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| timeout_sec | INTEGER | NOT NULL |
| last_ack_at | TIMESTAMPTZ | NULL |
| ack_detail | JSONB | NULL |

"명령을 보낸 것"과 "실행된 것"의 구분 표시(비기능 §4)가 이 테이블의 `status`로 구현된다.

## 4. `app` 스키마

**user** — Django `AUTH_USER_MODEL` 커스텀 (AIBootcamp members 패턴 참조, FR-31)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| email | TEXT | NOT NULL UNIQUE — 로그인 식별자 |
| password | TEXT | NOT NULL — Django 해시(argon2) |
| name | TEXT | NOT NULL |
| role | TEXT | NOT NULL DEFAULT 'viewer', CHECK (`admin`\|`manager`\|`viewer`) — 역할 체계는 OPN-07 확정 시 개편 |
| otp_enabled | BOOLEAN | NOT NULL DEFAULT false — 2단계 인증 |
| remote_access_enabled | BOOLEAN | NOT NULL DEFAULT true |
| is_active / is_staff | BOOLEAN | Django 표준 |
| created_at / last_login | TIMESTAMPTZ | |

**farm_memo** — 관리자 메모 (FR-18·28)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| author_id | BIGINT | NOT NULL, FK→user |
| farm_id | TEXT | NOT NULL — mw.farm 참조값 (스키마 경계: FK 없음, API 레벨 검증) |
| memo_date | DATE | NOT NULL — 달력 상 대상 일자 |
| body | TEXT | NOT NULL |
| via_voice | BOOLEAN | NOT NULL DEFAULT false — 음성 작성 여부 (FR-28) |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**attachment** — 메모 첨부 (FR-18)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| memo_id | BIGINT | NOT NULL, FK→farm_memo |
| storage_key | TEXT | NOT NULL — MinIO 객체 키 |
| media_type | TEXT | NOT NULL, CHECK (`image`\|`video`) |
| size_bytes | BIGINT | NOT NULL |
| uploaded_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**voice_log** — 음성 명령·메모 기록 (FR-29)

| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | BIGINT | PK |
| user_id | BIGINT | NOT NULL, FK→user |
| log_kind | TEXT | NOT NULL, CHECK (`command`\|`memo`) |
| spoken_text | TEXT | NULL — STT 결과 (텍스트 폴백 시 입력 원문) |
| recognized_intent | TEXT | NULL — 인식된 명령 |
| result | TEXT | NULL, CHECK (`executed`\|`rejected`\|`fallback`) |
| occurred_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

세션·권한 등 Django 프레임워크 테이블은 프레임워크 기본을 따른다 (명세 생략).

## 5. TimescaleDB 하이퍼테이블·인덱스 전략

| 하이퍼테이블 | chunk 간격 | 주 인덱스 |
|---|---|---|
| mw.environment_reading | 1 day | `(farm_id, sensor_id, ts DESC)`, `(farm_id, sensor_type, ts DESC)` |
| mw.robot_status | 1 day | `(farm_id, device_id, ts DESC)` |
| mw.weather_reading | 7 days | `(farm_id, ts DESC)` |

- 하이퍼테이블에는 FK·UNIQUE(파티션 키 미포함)를 걸지 않는다. 식별자 정합성은 수집기가 birth 등록 정보(`device_connection_state.birth_metrics`)와 대조해 검증한다.
- 압축: 7일 경과 chunk 압축 정책을 기본으로 하되, **보존 기간·백업 정책이 미결(OPN-06)이므로 retention policy는 TODO**로 두고 증분 1에서는 압축만 설정한다.
- 최신값 캐시(`sensor.last_value`, `tank.current_level_pct`)는 수집기가 적재 시 함께 갱신한다 — 대시보드 조회가 하이퍼테이블 스캔 없이 가능하도록.

## 6. MQTT 스키마 0.2 ↔ 테이블 매핑

| MQTT 메시지 (통신 규격 §4) | 적재 대상 | 비고 |
|---|---|---|
| sensor_reading | mw.environment_reading (+ sensor 최신값 캐시) | `sensor_id`·`location`은 sensor 레지스트리와 대조 |
| robot_status | mw.robot_status | `mission_state`·`charging` 포함 |
| pallet_task (발행) | mw.command_log + mw.pallet_task | task_id·command_id 이중 추적 |
| control_command / calibrate (발행) | mw.command_log (+ sensor_calibration) | |
| remote_stop / remote_stop_release (발행) | mw.command_log + mw.stop_event | |
| estop_state | mw.stop_event (stop_kind=`physical_estop`) | 표시 전용, 해제 명령 없음 |
| ack | mw.command_log.status 갱신 (+ pallet_task.status) | accepted/completed/failed 전이 |
| birth / death | mw.device_connection_state | metrics JSONB 보존 |
| (외부) 기상 API 응답 | mw.weather_reading | provider·raw 보존 |

## 7. 엔터티 대조표

`data-model.md` 28종 → 테이블 매핑. 신규 1종(command_log)은 data-model에 역반영한다.

| 엔터티 | 테이블 | | 엔터티 | 테이블 |
|---|---|---|---|---|
| Farm | mw.farm | | DataStatistics | mw.data_statistics |
| DeviceMeta | mw.device_meta | | FarmLog | **mw.farm_report + app.farm_memo (분리)** |
| Sensor | mw.sensor | | TaskSchedule | mw.task_schedule |
| SensorCalibration | mw.sensor_calibration | | VoiceLog | app.voice_log |
| Tank | mw.tank | | User | app.user |
| DeviceConnectionState | mw.device_connection_state | | Alert | mw.alert |
| RobotTaskLog | mw.robot_task_log | | AlertRule | mw.alert_rule |
| RobotStatus | mw.robot_status | | StopEvent | mw.stop_event |
| RobotSchedule | mw.robot_schedule | | WeatherReading | mw.weather_reading |
| RobotVideoAsset | mw.robot_video_asset | | FarmLayout | mw.farm_layout |
| Pallet / RackSlot / WorkStation | mw.pallet / rack_slot / work_station | | LayoutElement | mw.layout_element |
| PalletTask | mw.pallet_task | | (신규) CommandLog | mw.command_log |
| EnvironmentReading | mw.environment_reading | | GrowthAnalysis | mw.growth_analysis |
| DeviceControlSetting | mw.device_control_setting | | 첨부(FarmLog 내포) | app.attachment |

## 8. 미결 항목

- 보존 기간·retention policy — OPN-06 (압축은 7일 기본 적용)
- alert_rule 기본값 시드 — OPN-20
- 좌표계 확정 시 layout_element x/y 의미 부여 — OPN-21
- user.role 체계 개편 — OPN-07 잔여
- data_statistics의 continuous aggregate 전환 — 증분 9+에서 실측 후

## 변경 이력
- 2026-07-29 · 최초 작성 (OPN-09 해소). app/mw 스키마 분리·소유권 규칙, 테이블 31개 정의(mw 27 + app 4), 하이퍼테이블 3종, MQTT 0.2 매핑, FarmLog 분리(farm_report/farm_memo), command_log 신설
