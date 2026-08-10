# 팜온 스마트팜 HMI (smartfarmHMI)

RISE 피지컬 AI 기반 스마트농업 생태계 구축 사업 2차년도 · **웹앱 기반 스마트팜 HMI** 개발 저장소.

스마트팜(온실·식물공장)의 생육환경과 로봇을 웹에서 **실시간 모니터링·원격 제어**하는 시스템이다. 이름은 "웹앱"이지만 실제 범위는 4개 서비스 — 프론트엔드 웹앱, 애플리케이션 서버, 미들웨어 서버, 그리고 실물 엣지를 대신하는 가상 엣지(2차년도 한정)까지를 포함한다.

```
[가상 엣지 (virtual-edge)] ──MQTT──▶ [미들웨어 서버] ──내부 MQTT·REST──▶ [애플리케이션 서버] ──WebSocket·REST──▶ [웹앱]
  팜 단위 센서·로봇 시뮬레이션    수집·적재(TimescaleDB)              인증·게이트웨이(Django)         대시보드(Next.js)
  LWT·birth 자기기술 (독립 계약)  알림 엔진·커맨드 변환·정지 관리       Channels 푸시                   제어·알림·정지 UI
```

**주요 기능** (증분 0~7 구현 완료 — [개발 현황](./docs/04-roadmap/dev-increments.md)):
- 생육환경(온·습도·EC·CO₂·조도·전력)·로봇 상태 **실시간 모니터링** — MQTT → WebSocket 푸시
- 생육기 **원격 수동제어** (온·습도·양분·LED) — 명령 멱등성·ACK·타임아웃 추적
- **알림** — 임계 초과·통신 단절·명령 실패를 규칙 대조로 생성, 실시간 푸시·읽음·딥링크
- **정지 이원화** — 원격 전체 정지(웹 발동·해제, 발동 중 제어 차단) / 물리 비상정지(표시 전용, ISO 13850)
- **인증** — 이메일 로그인, HttpOnly 쿠키 JWT, 역할 3단계(admin/manager/viewer)
- **장치 통신 감시** — MQTT LWT 기반 온라인/응답지연/오프라인 판정

설계는 **다농장(N개)** 전제이며, 개발 환경 기본 구성은 **2개 팜**(성주 참외 온실 + 진주 토마토 온실 — 가상 엣지 컨테이너 각 1개)이다. 2차년도 실운영은 농장 1개.

---

## Getting Started — 개발 환경 구축

### 사전 요구사항

| 도구 | 버전 | 비고 |
|---|---|---|
| Docker + Docker Compose | Compose v2 | 유일한 필수 도구 — 언어 런타임 설치 불필요 |
| GNU Make | — | 명령 래퍼 |

포트는 **4xxxx 대역**을 사용한다 (AIBootcamp 5xxxx 대역과 동시 기동 가능).

### 1. 클론 및 기동

```bash
git clone git@github.com:DCUSnSLab/smartfarmHMI.git
cd smartfarmHMI
git checkout develop        # 개발 기준 브랜치

make env                    # .env.example → .env (없을 때만)
make up                     # 전체 9서비스 빌드·기동 (최초 수 분 소요)
```

### 2. DB 마이그레이션·시드

```bash
make migrate                # Django(app 스키마) + Alembic(mw 스키마·하이퍼테이블)
make seed                   # 농장·장비·알림규칙 + 계정 3종 (멱등 — 반복 실행 안전)
```

### 3. 확인

```bash
make health                 # 인프라 5항목 + 서비스 5항목 일괄 점검 → "ALL OK"
```

브라우저에서 **http://localhost:48080** 접속 → 로그인:

| 계정 | 비밀번호 | 역할 | 할 수 있는 것 |
|---|---|---|---|
| `admin@smartfarm.local` | `smartfarm123!` | 관리자 | 전부 |
| `manager@smartfarm.local` | `smartfarm123!` | 농장 관리자 | 제어·정지·알림 규칙 |
| `viewer@smartfarm.local` | `smartfarm123!` | 조회자 | 모니터링만 (제어 잠김) |

### 화면 구성

| 경로 | 화면 |
|---|---|
| `/` | 통합 대시보드 — Fleet KPI·농장별 현황 카드·전체 알림 |
| `/farms/{farmId}/{status,env,robot,supply,alerts}` | 농장 상세 5탭 — 상태·생육기·센서·로봇·작업공급·알림 |
| `/stats` · `/journal` · `/alerts` · `/support` · `/settings` | 통계·분석 · 농업일지 · 전역 알림 · 지원 · 설정 |

화면 구성은 `docs/design` 전달본 기준으로 갖춰져 있고, **아직 구현되지 않은 기능은 「개발 예정」 칩**으로 근거(FR·증분·OPN)와 함께 표시된다 — 구현 현황표는 [design-change-spec.md](./docs/design/design-change-spec.md) 참고.

로그인하면 **농장 2곳(성주·진주)** 을 스코프 스위처로 오가며 볼 수 있고, 성주는 센서 9종(환경 6 + 탱크 수위 3)·로봇 2대, 진주는 센서 5종·로봇 1대가 센서별 주기(5~40초)로 갱신된다. 환경 제어 슬라이더로 목표 온도를 바꾸면 명령이 「접수 대기 → 접수됨 → 완료」로 전이하고, 잠시 후 센서값이 목표로 이동한다.

### 4. 동작 확인 시나리오 (선택)

```bash
# 실시간 데이터 흐름 관찰 (엣지 원시 토픽)
make mqtt-sub T='farmon/v1/#'

# 통신 단절 페일세이프: 가상 엣지 강제 종료 → LWT → 화면 전 장치 오프라인
docker kill smartfarmhmi-virtual-edge-1   # 화면: 오프라인 배지 + 제어 잠김
docker compose up -d virtual-edge         # 복구: online 복귀

# 알림: 임계 초과 값 직접 발행 → 벨에 경고 도착
docker compose exec mosquitto mosquitto_pub -t 'farmon/v1/seongju/growbed/growbed-01/telemetry' -q 1 \
  -m '{"type":"sensor_reading","version":"0.3","farm_id":"seongju","device_id":"growbed-01","sensor_id":"temp-a","sensor_type":"temperature","value":40,"unit":"celsius","sensor_state":"ok","timestamp":"2026-07-30T12:00:00+09:00"}'

# 물리 비상정지 표시(FR-36): 엣지 상태 발행 모사 → 빨간 배너 (웹 해제 불가)
docker compose exec mosquitto mosquitto_pub -t 'farmon/v1/seongju/edge/edge-01/status' -q 1 \
  -m '{"type":"estop_state","version":"0.3","farm_id":"seongju","device_id":"edge-01","estop":"engaged","source":"field_device","timestamp":"2026-07-30T12:00:00+09:00"}'

# 같은 토픽에 estop:"unknown" 을 보내면 "확인 필요" 배너가 뜬다 — 엣지가 장치를
# 못 읽은 상태다. 정지로는 똑같이 잡히지만(안전측) 문구와 사유가 다르다 (§4.7)
docker compose exec mosquitto mosquitto_pub -t 'farmon/v1/seongju/edge/edge-01/status' -q 1 \
  -m '{"type":"estop_state","version":"0.3","farm_id":"seongju","device_id":"edge-01","estop":"unknown","reason":"read_failed","source":"field_device","timestamp":"2026-07-30T12:00:00+09:00"}'
```

### 주요 명령 (Makefile)

| 명령 | 내용 |
|---|---|
| `make up` / `make down` / `make clean` | 전체 기동 / 종료 / 컨테이너+볼륨 제거 |
| `make up-infra` | 인프라만 (timescaledb·redis·minio·mosquitto) |
| `make logs SVC=middleware` | 서비스 로그 팔로우 |
| `make migrate` / `make seed` | 마이그레이션 / 시드 (멱등) |
| `make health` | 전 서비스 헬스 일괄 확인 |
| `make psql` / `make redis-cli` / `make mqtt-sub` | 인프라 쉘·토픽 관찰 |
| `make api-shell` / `make mw-shell` | 컨테이너 bash |

### 호스트 포트 (기본값, `.env`에서 변경)

| 포트 | 대상 | 비고 |
|---|---|---|
| **48080** | nginx 단일 진입점 | **평소 접근은 여기로** (/→web, /api·/ws→api) |
| 48000 / 48001 | api / middleware 직접 | 디버깅용 |
| 43000 | web 직접 | 디버깅용 (WS는 게이트웨이 경유 필요) |
| 45432 / 46379 / 41883 | TimescaleDB / Redis / MQTT | |
| 49000 / 49001 | MinIO S3 / 콘솔 | |

### 소스 수정 시

api·middleware·web은 볼륨 마운트 + 핫리로드라 **소스 수정이 즉시 반영**된다. 예외:
- `virtual-edge` — 리로드 없음: `docker compose restart virtual-edge` (소스는 마운트됨, 의존성 변경 시 `--build`)
- 파이썬 **의존성 추가**(pyproject.toml) — 이미지 재빌드: `make build SVC=api && docker compose up -d api`
- `shared/schemas` 수정 — middleware 재시작 (virtual-edge 는 shared 미사용 — 독립 계약 구현)
- **api·web 컨테이너를 재생성(`up -d --build` 등)한 뒤 502 가 나면** — nginx 가 이전 IP 를 캐시한 것: `docker compose restart nginx`

### 개발 워크플로우

1. Notion Tasks에 태스크 생성 (프로젝트: 피지컬 AI) → Task ID 확보 (예: GEN-1210)
2. `develop`에서 `GEN-xxxx-작업명` 브랜치 분기, 커밋 컨벤션 `feat(GEN-xxxx): ...`
3. PR base는 **develop** (develop→main은 릴리즈 PR)
4. 증분·DoD는 [dev-increments.md](./docs/04-roadmap/dev-increments.md)를 따른다

**경계 규칙**: 서비스 간 코드 import 금지. 유일한 공유는 `shared/schemas`(MQTT pydantic 모델, **middleware 전용**). virtual-edge 는 통신 규격 문서만으로 독립 구현한다. 상세: [tech-stack.md](./docs/03-architecture/tech-stack.md) §3.

---

## 배포 (K8s)

배포는 Kustomize + Jenkins 파이프라인 구조다.

| 브랜치 | 네임스페이스 | 환경 | 노출 | 상태 |
|---|---|---|---|---|
| `develop` | `smartfarmhmi-dev` | dev | NodePort 30480 | **운영 중** |
| `main` | `smartfarmhmi` | 운영 | NodePort 30481 | 미개통 (TLS·도메인·Harbor 프로젝트 TODO) |

- 매니페스트: `deploy/k8s/` (base + overlays/{dev,main}) — 렌더 확인: `kubectl kustomize deploy/k8s/overlays/dev`
- **최초 1회 사전 작업**(네임스페이스·Secret 5종·시드): [deploy/k8s/README.md](./deploy/k8s/README.md)
- 파이프라인: `Jenkinsfile` — 브랜치별 환경 결정 → 이미지 빌드(`BUILD_NUMBER-GIT_SHA` 불변 태그) → Harbor push → 인프라·마이그레이션 Job·워크로드 순차 적용. develop 머지 후 Jenkins 주기 스캔으로 배포된다 (Jenkins 가 내부망이라 webhook 불가 — 즉시 배포하려면 잡에서 수동 실행)
- 설정값 배치: 비밀값은 Secret, 환경별 값은 ConfigMap(`overlays/*/config.env` — **git 커밋됨**). 기준은 [deploy/k8s/README.md](./deploy/k8s/README.md) 참고
- 운영 전 필수: Mosquitto 인증·TLS·ACL (OPN-22), 쿠키 `secure` 전환, main overlay TLS·도메인

---

## 문서

### 진입 순서

1. [00-overview.md](./00-overview.md) — 사업 배경, 개발 범위, 시스템 목표
2. [docs/01-requirements/functional.md](./docs/01-requirements/functional.md) — 기능 요구사항 (41개 기능)
3. [docs/01-requirements/non-functional.md](./docs/01-requirements/non-functional.md) — 품질 속성 (안전·페일세이프·통신 신뢰성·접근성 포함)
4. [docs/02-domain/data-model.md](./docs/02-domain/data-model.md) — 데이터 엔터티
5. [docs/02-domain/db-schema.md](./docs/02-domain/db-schema.md) — DB 스키마 (필드·타입·제약, app/mw 분리)
6. [docs/03-architecture/system-architecture.md](./docs/03-architecture/system-architecture.md) — 시스템 구성
7. [docs/03-architecture/communication-interface.md](./docs/03-architecture/communication-interface.md) — 통신 규격 (MQTT 토픽·메시지 스키마)
8. [docs/03-architecture/component-mapping.md](./docs/03-architecture/component-mapping.md) — 기능별 컴포넌트 책임
9. [docs/03-architecture/component-internals.md](./docs/03-architecture/component-internals.md) — 각 컴포넌트 내부 모듈 구성
10. [docs/03-architecture/tech-stack.md](./docs/03-architecture/tech-stack.md) — 기술 스택 (AIBootcamp 정합)
11. [docs/04-roadmap/phase2-scope.md](./docs/04-roadmap/phase2-scope.md) — 2차년도 로드맵
12. [docs/04-roadmap/dev-increments.md](./docs/04-roadmap/dev-increments.md) — **개발 증분 계획·현황** (증분 0~7 완료, 8 보류)
13. [docs/design/README.md](./docs/design/README.md) — 디자인 전달본 (화면 구조·디자인 토큰)
14. [docs/design/design-change-spec.md](./docs/design/design-change-spec.md) — 디자인 변경 명세

> 문서 번호(`00-`, `01-1` 등)는 파일 헤더의 표기이고, 위 목록은 읽는 순서다.

### 디렉토리 구조

```
/
├─ README.md                    ← 본 문서 (소개 · Getting Started · 색인)
├─ 00-overview.md               ← 사업 배경 · 개발 범위
├─ web/                         ← 웹앱 (Next.js 15 · React 19 · Tailwind)
├─ api/                         ← 애플리케이션 서버 (Django 5.2 + DRF + Channels)
├─ middleware/                  ← 미들웨어 서버 (FastAPI + aiomqtt + Alembic)
├─ virtual-edge/                ← 가상 엣지 (2차년도 한정 데이터원 + 격리 연동 테스트 하네스, 실엣지 교체 예정)
├─ shared/schemas/              ← MQTT 메시지 pydantic 모델 (유일한 서비스 간 공유)
├─ deploy/
│  ├─ nginx/  ├─ mosquitto/  ├─ timescaledb/
│  └─ k8s/                      ← Kustomize base + overlays/{dev,main}
├─ docker-compose.yml · Makefile · Jenkinsfile · .env.example
└─ docs/
   ├─ 01-requirements/          ← functional · non-functional
   ├─ 02-domain/                ← data-model · db-schema
   ├─ 03-architecture/          ← system · communication · mapping · internals · tech-stack
   ├─ 04-roadmap/               ← phase2-scope · dev-increments (개발 현황)
   └─ design/                   ← 디자인 전달본 + 변경 명세
```

## 결정된 사항

이전까지 미해결이던 항목 중 확정된 것이다.

| ID | 결정 내용 | 관련 문서 |
|---|---|---|
| OPN-01 | **미들웨어 서버 ↔ 엣지 통신은 MQTT로 확정.** 로봇 내부가 ROS2를 쓰더라도 엣지가 ROS2↔MQTT 브리지 역할을 맡는다 | docs/03-architecture/communication-interface.md |
| OPN-12 | **애플리케이션 서버 ↔ 미들웨어 서버는 내부 MQTT 구독(실시간) + REST(이력·설정)로 확정.** 미들웨어가 정규화해 재발행한 내부 토픽만 구독하고, 엣지 원시 토픽은 직접 구독하지 않는다 | docs/03-architecture/system-architecture.md, docs/03-architecture/communication-interface.md |
| OPN-03 | **DB는 PostgreSQL 16 + TimescaleDB 확장으로 확정.** 시계열 테이블만 하이퍼테이블화하는 하이브리드 구성. AIBootcamp과 동일 엔진 | docs/03-architecture/tech-stack.md |
| OPN-07 (일부) | **인증 방식 확정 — AIBootcamp 패턴 재사용** (SimpleJWT + HttpOnly 쿠키 세션 + 역할 가드 미들웨어). 권한 분리 수준(역할 체계)은 미결로 남음 | docs/03-architecture/tech-stack.md, docs/01-requirements/non-functional.md |
| OPN-19 | **물리 비상정지 상태는 엣지가 발행해 주기로 확정** (`estop_state` 메시지). FR-36은 2차년도 범위에서 구현 완료 | docs/01-requirements/functional.md, docs/03-architecture/communication-interface.md |
| 스택 | **웹(프론트엔드·애플리케이션 서버) 스택은 AIBootcamp 시스템과 정합** — Next.js 15 · React 19 · TypeScript · Tailwind / Django 5.2 + DRF + Channels. 브로커는 Mosquitto | docs/03-architecture/tech-stack.md |
| OPN-09 | **DB 스키마 확정** — app/mw 스키마 분리, 테이블 31개(mw 27 + app 4), 하이퍼테이블 3종, MQTT 0.2 매핑 | docs/02-domain/db-schema.md |
| OPN-15 | **저장소는 같은 PostgreSQL 인스턴스에 `app`/`mw` 스키마 분리로 확정.** 소유권 = 마이그레이션 권한 = 접근 권한, DB 계정도 분리. 물리 분리는 부하 확인 후 재판단 | docs/02-domain/db-schema.md |

## 미해결 이슈 색인

아직 결정되지 않은 항목이다.

| ID | 내용 | 관련 문서 |
|---|---|---|
| OPN-02 | 실제 엣지 연동 시점 및 방식 | 00-overview.md, docs/03-architecture/system-architecture.md |
| OPN-04 | 실시간성 목표 수치 (응답/화면 반영 지연 등) | docs/01-requirements/non-functional.md |
| OPN-05 | 동시 접속자 수 목표 | docs/01-requirements/non-functional.md |
| OPN-06 | 데이터 보존 기간·백업 정책 | docs/01-requirements/non-functional.md |
| OPN-07 | 권한 분리 수준·역할 체계 (인증 방식은 확정 — 위 표 참고. 현재 admin/manager/viewer 잠정 운용) | docs/01-requirements/non-functional.md, docs/03-architecture/tech-stack.md |
| OPN-08 | 가용성 목표 | docs/01-requirements/non-functional.md |
| OPN-10 | 통신 메시지 스키마 필드 리뷰 | docs/03-architecture/communication-interface.md |
| OPN-11 | 2차년도 데모 상세 시나리오 확정 | 00-overview.md, docs/04-roadmap/phase2-scope.md |
| OPN-13 | 다중 로봇 제어(FR-02) 담당 여부 (우리 팀 vs 엣지팀) — 증분 8 검토 논점과 연결 | docs/01-requirements/functional.md, docs/04-roadmap/dev-increments.md |
| OPN-14 | LED 파레트별 개별 제어 필요성 및 방식 (2차년도는 그룹/전체 제어로 진행) | docs/01-requirements/functional.md, docs/01-requirements/non-functional.md |
| OPN-16 | 생육기 단위 모니터링·제어 UI 구성 (자체 설계안을 제시했으나 확정 보류) | docs/design/design-change-spec.md, docs/01-requirements/functional.md |
| OPN-17 | 외부 기상 API 공급자 선정 (기상청 단기예보 등) | docs/01-requirements/functional.md, docs/03-architecture/communication-interface.md |
| OPN-18 | 원격 전체 정지(FR-35) 해제 권한 수준 (현재 admin/manager 잠정) | docs/01-requirements/non-functional.md, docs/01-requirements/functional.md |
| OPN-20 | 알림 임계값 기본값·에스컬레이션 정책 (현재 잠정 시드로 운용) | docs/01-requirements/functional.md |
| OPN-21 | 실시간 배치도 좌표계 원점·스케일 — **엣지팀 협의 필요 (진행 중)** | docs/03-architecture/communication-interface.md, docs/02-domain/data-model.md |
| OPN-22 | MQTT 브로커 배치(미들웨어 내장 vs 별도)와 인증·TLS 정책 (브로커 소프트웨어는 Mosquitto 확정, dev는 익명 접속) | docs/03-architecture/tech-stack.md, docs/03-architecture/system-architecture.md |
| OPN-23 | 다농장 실운영 전환 시점 (2차년도는 농장 1개로 운영) | 00-overview.md, docs/04-roadmap/phase2-scope.md |

## 변경 이력

- 2026-07-07 · 최초 작성
- 2026-07-29 · 문서를 `docs/` 하위로 이동, 디자인 전달본 추가에 따른 색인·링크 정리. OPN-01·OPN-12 확정, OPN-16~23 추가
- 2026-07-29 · 기술 스택 확정(tech-stack.md 신설, AIBootcamp 정합). OPN-03(DB)·OPN-19(물리 비상정지 상태 취득)·OPN-07 중 인증 방식 확정
- 2026-07-29 · 개발 착수 — DB 스키마 정의(db-schema.md, OPN-09·15 해소), 개발 증분 계획(dev-increments.md), 개발 스캐폴딩(모노레포·compose·k8s 스켈레톤), develop 브랜치 신설
- 2026-07-30 · 증분 0~7 구현 완료 반영 — 프로젝트 소개·Getting Started 튜토리얼·배포 안내로 README 개편, 개발 현황 표 신설(dev-increments.md), 증분 8 보류·검토 논점 기록
- 2026-08-06 · **dev 서버 개통** (GEN-1264) — k8s 매니페스트 누락분 보강, Jenkins Harbor push·배포 연결. 배포 절이 스켈레톤 안내에서 실제 접속 정보·시드 계정으로 바뀜
