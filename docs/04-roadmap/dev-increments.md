# 04-2 · 개발 증분 계획

한번에 전부 만들지 않고, **동작 검증 가능한 수직 조각(증분)** 을 순서대로 완성한다. 각 증분은 완료 기준(DoD)을 충족해야 다음으로 넘어간다. 증분 2~4가 `phase2-scope.md` "현재 개발 범위"와 일치한다.

브랜치 전략: 증분(또는 그 하위 작업) 단위 브랜치 → PR base **develop** → develop→main은 릴리즈 PR. 배포는 develop→dev 환경, main→운영 환경 (`../03-architecture/tech-stack.md`, Jenkinsfile).

## 증분 목록

### 증분 0 — 개발 스캐폴딩 ✅ (이번 PR)

전 서비스가 docker-compose로 기동되고 health가 확인되는 상태. 기능 코드 없음.

- 모노레포 구조 (web / api / middleware / edge-sim / shared/schemas / deploy)
- compose 9서비스: timescaledb·redis·minio·mosquitto·api·middleware·edge-sim·web·nginx
- k8s Kustomize base + overlays(dev/main) 스켈레톤, Jenkinsfile 스켈레톤
- **DoD**: `make clean && make env && make up` 후 `make health` 전부 OK. `kubectl kustomize` 렌더 무오류

### 증분 1 — 스키마 구현

`../02-domain/db-schema.md`를 마이그레이션으로 구현.

- Alembic 초기 마이그레이션 (`mw` 스키마 27테이블 + 하이퍼테이블 3종 + 압축 정책)
- Django 초기 마이그레이션 (`app` 스키마: user·farm_memo·attachment·voice_log)
- DB 계정 분리 (`app_user`/`mw_user`, 상대 스키마 권한 없음)
- 개발용 시드: 농장 1개 + 장비 몇 종
- **DoD**: `make migrate` 성공. psql로 하이퍼테이블·인덱스·계정 권한 확인. 시드 조회 확인

### 증분 2 — 수집 슬라이스 (엣지 → DB)

첫 데이터 흐름. FR-08·16·37(수신부).

- shared/schemas: MQTT 0.2 전 메시지 pydantic 모델
- edge-sim: birth 발행 + LWT 등록 + 센서값 주기 발행 (패턴 기반, 이상값 옵션)
- middleware: 구독 → pydantic 검증 → environment_reading 적재 + sensor 최신값 캐시 갱신
- middleware: birth/death 처리 → device_connection_state 전이, 통신 규격 §5 판정(주기 배수)
- **DoD**: edge-sim 발행값이 DB에 적재. edge-sim kill 시 LWT로 offline 전이 확인. 중복 timestamp 재발행에도 정상 동작

### 증분 3 — 조회 슬라이스 (DB → 브라우저)

첫 화면. FR-04·08·38.

- middleware: 내부 토픽 재발행 (`farmon-internal/v1/{farm}/environment` 등) + 내부 REST(최신값·이력)
- api: 내부 MQTT 구독 프로세스(**단일 인스턴스**, management command) → Redis 채널 레이어
- api: Channels 컨슈머 (연결·그룹 가입·푸시 — 인증은 증분 5 전까지 개발 모드 우회)
- web: 대시보드 MVP — 농장 스코프 전환, 환경값 실시간 카드, 마지막 수신 시각·통신 상태 표시
- **DoD**: 브라우저에서 센서값 실시간 갱신. edge-sim 중단 시 화면에 "응답 지연/오프라인" 표시. ASGI 워커 2개에서 중복 푸시 없음

### 증분 4 — 제어 슬라이스 (브라우저 → 엣지)

역방향 흐름. FR-10.

- web: 생육기 수동제어 UI (온·습도·양분·LED 4종)
- api: 설정 요청 API → middleware 내부 REST
- middleware: command_log 기록 → control_command 발행 (retain=false) → ack 수신·상태 전이·타임아웃
- edge-sim: command 수신 → command_id 멱등 처리 → ack(accepted→completed) 응답
- **DoD**: UI 설정 → edge-sim 로그 반영 → UI에 "접수/완료" 구분 표시. 같은 command_id 재발행 시 재실행 없음. 타임아웃 시 실패 표시

### 증분 5 — 인증 (FR-31)

AIBootcamp 패턴 이식.

- api: LocalAuthAdapter + SimpleJWT + HttpOnly 쿠키 발급 (AIBootcamp Sub-Plan 0.2 참조)
- web: 로그인 화면 3종(폼·실패·권한 없음), jose 디코드 미들웨어 + 역할 가드 (Sub-Plan 0.3 참조)
- Channels 연결 인증 (증분 3의 우회 제거)
- **DoD**: 미로그인 시 대시보드·WebSocket 접근 차단. 역할별 라우팅 동작

### 증분 6 — 알림 (FR-32~34)

- middleware: 알림 엔진 — 수집값·통신 상태·탱크 잔량을 alert_rule과 대조해 alert 생성·재발행
- web: 전역 알림 패널 + 알림 화면(필터·읽음·딥링크) + 규칙 설정 UI
- **DoD**: 임계 초과 발행 → 알림 생성 → 실시간 푸시 → 딥링크 이동 → 읽음 처리까지 왕복

### 증분 7 — 정지 (FR-35~37 완성)

- 원격 전체 정지: 발동·확인 절차·전역 배너·해제 + **미들웨어 차단**(자동 스케줄·명령 발행 거부)
- 물리 비상정지: edge-sim estop_state 발행 → 구분 배너 표시 (해제 UI 없음)
- **DoD**: 정지 중 제어 요청이 미들웨어에서 거부됨을 확인. 두 배너 동시 표시 검증. stop_event 이력 조회

### 증분 8 — 스케줄·공급 (FR-03·19·21~26)

- task_schedule CRUD + 스케줄러(시각 도달 → pallet_task 생성·발행)
- 충돌 검사 3자원(로봇·워크스테이션·파레트) — 디자인 결함 #3 해소
- 양·농도 설정 UI (양액·급수·방재 3종 동등)
- edge-sim: pallet_task 수락→진행→완료 시뮬레이션
- **DoD**: 스케줄 등록 → 시각 도달 → 임무 발행 → 완료 응답 → 작업 로그 적재. 충돌 등록 거부 확인

### 증분 9+ — 잔여 기능 (증분 8 완료 후 재계획)

통계·조회(FR-14·15), 농업일지(FR-17·18), 음성/LLM 훅(FR-27~30), 배치도(FR-41), 영상(FR-05·09), 장비 관리 화면(FR-07·13), 로봇 자동충전 표시(FR-06), 접근성 3단계 적용 등. 8월 실 하드웨어 연동 일정과 데모 시나리오(OPN-11)에 맞춰 우선순위를 다시 정한다.

## 원칙

1. **증분마다 끝에서 끝까지** — 레이어 하나를 다 만들고 다음 레이어로 가지 않는다. 매 증분이 실행 가능한 데모다.
2. **경계 규칙** — 서비스 간 코드 import 금지. 유일한 공유는 `shared/schemas`(MQTT pydantic 모델, middleware·edge-sim만 참조). api·web은 내부 토픽/REST 계약으로만 통신한다.
3. **DoD를 통과하지 못하면 다음 증분을 시작하지 않는다.**
4. 증분 완료 시 본 문서에 상태(✅)와 실제 PR 번호를 기록한다.

## 변경 이력
- 2026-07-29 · 최초 작성 (증분 0~8 + 원칙)
