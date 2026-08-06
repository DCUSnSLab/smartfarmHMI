# 04-2 · 개발 증분 계획 및 현황

한번에 전부 만들지 않고, **동작 검증 가능한 수직 조각(증분)** 을 순서대로 완성한다. 각 증분은 완료 기준(DoD)을 충족해야 다음으로 넘어간다. 증분 2~4가 `phase2-scope.md` "현재 개발 범위"와 일치한다.

브랜치 전략: 증분(또는 그 하위 작업) 단위 브랜치 → PR base **develop** → develop→main은 릴리즈 PR. 배포는 develop→dev 환경, main→운영 환경 (`../03-architecture/tech-stack.md`, Jenkinsfile).

## 개발 현황 (2026-08-06 기준)

| 증분 | 티켓 | PR | 상태 |
|---|---|---|---|
| 0 스캐폴딩 | GEN-1208 | [#2](https://github.com/DCUSnSLab/smartfarmHMI/pull/2) | ✅ 완료 |
| 1 스키마 구현 | GEN-1210 | [#3](https://github.com/DCUSnSLab/smartfarmHMI/pull/3) | ✅ 완료 |
| 2 수집 슬라이스 | GEN-1211 | [#4](https://github.com/DCUSnSLab/smartfarmHMI/pull/4) | ✅ 완료 |
| 3 조회 슬라이스 | GEN-1212 | [#5](https://github.com/DCUSnSLab/smartfarmHMI/pull/5) | ✅ 완료 |
| 4 제어 슬라이스 | GEN-1213 | [#6](https://github.com/DCUSnSLab/smartfarmHMI/pull/6) | ✅ 완료 |
| 5 인증 | GEN-1214 | [#7](https://github.com/DCUSnSLab/smartfarmHMI/pull/7) | ✅ 완료 |
| 6 알림 | GEN-1215 | [#8](https://github.com/DCUSnSLab/smartfarmHMI/pull/8) | ✅ 완료 |
| 7 정지 | GEN-1216 | [#9](https://github.com/DCUSnSLab/smartfarmHMI/pull/9) | ✅ 완료 |
| **8 스케줄·공급** | — | — | ⏸ **보류 — 착수 전 검토 필요 (아래 논점)** |
| 9+ 잔여 기능 | — | — | 증분 8 이후 재계획 |
| (병행) HMI UI/UX 전면 구현 | GEN-1224 | PR 대기 | 🔨 화면 12종·모달 5종 구성 완료 — 구현 기능은 실데이터, 미구현은 「개발 예정」 표기 |
| (병행) 설정 화면·장비 관리 | GEN-1223 | [#16](https://github.com/DCUSnSLab/smartfarmHMI/pull/16) | ✅ 완료 |
| (병행) 개발환경 멀티팜 | GEN-1222 | [#15](https://github.com/DCUSnSLab/smartfarmHMI/pull/15) | ✅ 완료 |
| (병행) 가상 엣지 + 시뮬레이터 통합 | GEN-1217 | [#12](https://github.com/DCUSnSLab/smartfarmHMI/pull/12) | ✅ 구현 완료 — `virtual-edge/` 하네스(연동 시나리오 11종) + **edge-sim 통합 제거** (기본 스택 데이터원 교체, 로봇 시뮬 이식) |
| (병행) **dev 클러스터 배포** | GEN-1264 | [#31](https://github.com/DCUSnSLab/smartfarmHMI/pull/31) | ✅ **개통** — NodePort 30480, develop 머지 후 Jenkins 배포 |

증분 2~4 완료로 `phase2-scope.md` "현재 개발 범위"는 **전체 달성**됐다. 실행 환경 구축은 루트 `README.md` Getting Started 참고.

**dev 배포 시 유의** — **compose 에 서비스를 추가하면 k8s 매니페스트에도 반드시 반영할 것**
— 로컬은 compose 가 돌리므로 누락돼도 드러나지 않는다.

## 증분 목록

### 증분 0 — 개발 스캐폴딩 ✅ (GEN-1208 · PR #2)

전 서비스가 docker-compose로 기동되고 health가 확인되는 상태. 기능 코드 없음.

- 모노레포 구조 (web / api / middleware / edge-sim / shared/schemas / deploy)
- compose 9서비스: timescaledb·redis·minio·mosquitto·api·middleware·edge-sim·web·nginx
- k8s Kustomize base + overlays(dev/main) 스켈레톤, Jenkinsfile 스켈레톤
- **DoD**: `make clean && make env && make up` 후 `make health` 전부 OK. `kubectl kustomize` 렌더 무오류

### 증분 1 — 스키마 구현 ✅ (GEN-1210 · PR #3)

`../02-domain/db-schema.md`를 마이그레이션으로 구현.

- Alembic 초기 마이그레이션 (`mw` 스키마 27테이블 + 하이퍼테이블 3종 + 압축 정책)
- Django 초기 마이그레이션 (`app` 스키마: user·farm_memo·attachment·voice_log)
- DB 계정 분리 (`app_user`/`mw_user`, 상대 스키마 권한 없음)
- 개발용 시드: 농장 1개 + 장비 몇 종
- **DoD**: `make migrate` 성공. psql로 하이퍼테이블·인덱스·계정 권한 확인. 시드 조회 확인

### 증분 2 — 수집 슬라이스 (엣지 → DB) ✅ (GEN-1211 · PR #4)

첫 데이터 흐름. FR-08·16·37(수신부).

- shared/schemas: MQTT 0.2 전 메시지 pydantic 모델
- edge-sim: birth 발행 + LWT 등록 + 센서값 주기 발행 (패턴 기반, 이상값 옵션)
- middleware: 구독 → pydantic 검증 → environment_reading 적재 + sensor 최신값 캐시 갱신
- middleware: birth/death 처리 → device_connection_state 전이, 통신 규격 §5 판정(주기 배수)
- **DoD**: edge-sim 발행값이 DB에 적재. edge-sim kill 시 LWT로 offline 전이 확인. 중복 timestamp 재발행에도 정상 동작

### 증분 3 — 조회 슬라이스 (DB → 브라우저) ✅ (GEN-1212 · PR #5)

첫 화면. FR-04·08·38.

- middleware: 내부 토픽 재발행 (`farmon-internal/v1/{farm}/environment` 등) + 내부 REST(최신값·이력)
- api: 내부 MQTT 구독 프로세스(**단일 인스턴스**, management command) → Redis 채널 레이어
- api: Channels 컨슈머 (연결·그룹 가입·푸시 — 인증은 증분 5 전까지 개발 모드 우회)
- web: 대시보드 MVP — 농장 스코프 전환, 환경값 실시간 카드, 마지막 수신 시각·통신 상태 표시
- **DoD**: 브라우저에서 센서값 실시간 갱신. edge-sim 중단 시 화면에 "응답 지연/오프라인" 표시. ASGI 워커 2개에서 중복 푸시 없음

### 증분 4 — 제어 슬라이스 (브라우저 → 엣지) ✅ (GEN-1213 · PR #6)

역방향 흐름. FR-10.

- web: 생육기 수동제어 UI (온·습도·양분·LED 4종)
- api: 설정 요청 API → middleware 내부 REST
- middleware: command_log 기록 → control_command 발행 (retain=false) → ack 수신·상태 전이·타임아웃
- edge-sim: command 수신 → command_id 멱등 처리 → ack(accepted→completed) 응답
- **DoD**: UI 설정 → edge-sim 로그 반영 → UI에 "접수/완료" 구분 표시. 같은 command_id 재발행 시 재실행 없음. 타임아웃 시 실패 표시

### 증분 5 — 인증 (FR-31) ✅ (GEN-1214 · PR #7)

AIBootcamp 패턴 이식.

- api: LocalAuthAdapter + SimpleJWT + HttpOnly 쿠키 발급 (AIBootcamp Sub-Plan 0.2 참조)
- web: 로그인 화면 3종(폼·실패·권한 없음), jose 디코드 미들웨어 + 역할 가드 (Sub-Plan 0.3 참조)
- Channels 연결 인증 (증분 3의 우회 제거)
- **DoD**: 미로그인 시 대시보드·WebSocket 접근 차단. 역할별 라우팅 동작

### 증분 6 — 알림 (FR-32~34) ✅ (GEN-1215 · PR #8)

- middleware: 알림 엔진 — 수집값·통신 상태·탱크 잔량을 alert_rule과 대조해 alert 생성·재발행
- web: 전역 알림 패널 + 알림 화면(필터·읽음·딥링크) + 규칙 설정 UI
- **DoD**: 임계 초과 발행 → 알림 생성 → 실시간 푸시 → 딥링크 이동 → 읽음 처리까지 왕복

### 증분 7 — 정지 (FR-35~37 완성) ✅ (GEN-1216 · PR #9)

- 원격 전체 정지: 발동·확인 절차·전역 배너·해제 + **미들웨어 차단**(자동 스케줄·명령 발행 거부)
- 물리 비상정지: edge-sim estop_state 발행 → 구분 배너 표시 (해제 UI 없음)
- **DoD**: 정지 중 제어 요청이 미들웨어에서 거부됨을 확인. 두 배너 동시 표시 검증. stop_event 이력 조회

### 증분 8 — 스케줄·공급 (FR-03·19·21~26) ⏸ 보류

> **착수 전 검토 필요 — 사용자 검토 후 재개한다 (2026-07-30 결정).** 아래 논점이 정리돼야 설계가 확정된다.

**착수 전 검토 논점**

1. **충돌 검사 3자원의 판정 기준** — 로봇·워크스테이션·파레트의 시간 겹침을 "예약 시각 ± 소요시간"으로 볼지, 소요시간을 누가 추정할지 (실물 엣지가 없는 2차년도에는 작업유형별 고정값?)
2. **스케줄 도달 → 임무 변환의 파레트 선정** — "생육기별 양액 공급"이 파레트 몇 개를 대상으로 하는지 (전체 순회 / 지정 목록 / 라운드로빈) — 요구사항이 여기까지 정의하지 않음
3. **로봇 배정 주체** — 임무를 어느 로봇에 줄지 미들웨어가 정하는지, 엣지가 정하는지 (OPN-13 다중 로봇 담당과 연결)
4. **정지·통신단절 중 스케줄 도달 시 처리** — 보류 후 재개 시 소급 실행할지, 해당 회차를 건너뛸지
5. **UI 범위** — 디자인의 작업·공급 화면(탱크 수위·워크스테이션 흐름·랙 슬롯 현황 포함)을 어디까지 이번 증분에 넣을지

**계획된 범위 (검토 후 조정)**

- task_schedule CRUD + 스케줄러(시각 도달 → pallet_task 생성·발행)
- 충돌 검사 3자원(로봇·워크스테이션·파레트) — 디자인 결함 #3 해소
- 양·농도 설정 UI (양액·급수·방재 3종 동등)
- edge-sim: pallet_task 수락→진행→완료 시뮬레이션
- **DoD**: 스케줄 등록 → 시각 도달 → 임무 발행 → 완료 응답 → 작업 로그 적재. 충돌 등록 거부 확인

**증분 7까지 이미 준비된 기반**: `mw.task_schedule`·`pallet_task`·`rack_slot`·`work_station` 테이블과 충돌검사용 인덱스(증분 1), `PalletTaskMsg` 스키마·command_log 멱등·ACK 체계(증분 4), 정지 중 발행 차단 지점 `is_remote_stopped`(증분 7).

### 증분 9+ — 잔여 기능 (증분 8 완료 후 재계획)

통계·조회(FR-14·15), 농업일지(FR-17·18), 음성/LLM 훅(FR-27~30), 배치도(FR-41), 영상(FR-05·09), 장비 관리 화면(FR-07·13), 로봇 자동충전 표시(FR-06), 접근성 3단계 적용 등. 8월 실 하드웨어 연동 일정과 데모 시나리오(OPN-11)에 맞춰 우선순위를 다시 정한다.

## 원칙

1. **증분마다 끝에서 끝까지** — 레이어 하나를 다 만들고 다음 레이어로 가지 않는다. 매 증분이 실행 가능한 데모다.
2. **경계 규칙** — 서비스 간 코드 import 금지. 유일한 공유는 `shared/schemas`(MQTT pydantic 모델, **middleware 전용**). virtual-edge 는 통신 규격 문서만으로 독립 구현하고, api·web은 내부 토픽/REST 계약으로만 통신한다.
3. **DoD를 통과하지 못하면 다음 증분을 시작하지 않는다.**
4. 증분 완료 시 본 문서에 상태(✅)와 실제 PR 번호를 기록한다.

## 구현 중 확정된 사항 (증분 0~7)

문서에 없던 것 중 구현 과정에서 결정·검증된 계약이다. 상세는 각 PR 본문 참고.

- **LWT death 정리 계약** — LWT 페이로드의 `timestamp`는 접속 시점 생성이라 birth와 선후 비교가 불가능하다. 엣지는 **정상 재접속 직후 빈 retained 발행으로 자신의 retained death를 삭제**해야 한다 (`../03-architecture/communication-interface.md` §3에 반영). 실제 엣지 구현체(3차년도)에도 요구되는 계약
- **주기 미선언 장치는 LWT 전용 판정** — birth에 `publish_interval_sec`를 선언하지 않은 장치(엣지 컨트롤러 등)는 주기 배수 판정에서 제외
- **엣지 death cascade** — 엣지 컨트롤러 death 수신 시 해당 농장 전 장치를 offline 처리 (엣지가 유일한 통신 통로)
- **하이퍼테이블 복합 PK + ON CONFLICT DO NOTHING** — QoS1 중복 배달 멱등 적재
- **알림 중복 억제** — 같은 dedup_key의 미확인 알림이 있으면 재생성하지 않음 (읽음 후 재발생)
- **토큰 role 클레임** — API·WS 인증 검증이 무상태 (역할 변경은 재로그인 반영)
- **정지 차단 위치** — 원격 전체 정지 중 제어 거부(HTTP 423)는 미들웨어 `issue_control`에서 수행, UI 비활성화에 의존하지 않음

## 변경 이력
- 2026-07-29 · 최초 작성 (증분 0~8 + 원칙)
- 2026-07-31 · 병행 트랙 갱신 (GEN-1222·1223·1224). UI/UX 전면 구현으로 화면 체계 완성 — 미구현 기능은 화면에 「개발 예정」으로 표시되어 추적된다
- 2026-07-30 · 개발 현황 표 추가 (증분 0~7 완료, PR #2~#9). 증분 8 보류 처리 + 착수 전 검토 논점 5건 기록. 구현 중 확정 사항 절 신설
- 2026-08-06 · dev 클러스터 개통 (GEN-1264) — 현황 표에 배포 트랙 추가, compose↔k8s 정합 유지 유의사항 기록