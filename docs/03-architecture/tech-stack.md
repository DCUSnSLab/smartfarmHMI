# 03-5 · 기술 스택

웹(프론트엔드·애플리케이션 서버) 스택은 **AIBootcamp 시스템 스택과 결을 함께한다**는 결정에 따라 선정했다 (2026-07-29). AIBootcamp에서 이미 검증된 구성(인증 흐름, 배포 구성, 코드 컨벤션)을 재사용해 학습 비용과 운영 부담을 줄이는 것이 목적이다.

## 1. 선정 결과

| 계층 | 스택 | AIBootcamp 정합 |
|---|---|---|
| 프론트엔드 (웹앱) | **Next.js 15 · React 19 · TypeScript 5.6 · Tailwind CSS 3.4** | 동일 |
| 애플리케이션 서버 | **Django 5.2 LTS + DRF** + SimpleJWT + drf-spectacular + **Django Channels**(WebSocket) | 동일 + Channels 추가 |
| 인증 | **HttpOnly 쿠키 세션 (JWT, jose 디코드) + 역할 가드 미들웨어** | AIBootcamp Sub-Plan 0.2·0.3 패턴 재사용 |
| 미들웨어 서버 | **Python 3.12 + FastAPI**(내부 REST) + **aiomqtt**(MQTT 클라이언트) + SQLAlchemy/asyncpg | 언어·런타임 동일 계열 |
| DB | **PostgreSQL 16 + TimescaleDB 확장** (시계열 테이블만 하이퍼테이블화) | PostgreSQL 16 동일 |
| 캐시·채널 레이어 | **Redis 7** (Channels 채널 레이어 + 캐시) | 동일 |
| MQTT 브로커 | **Eclipse Mosquitto 2.x** (토픽 ACL 지원) | 신규 (AIBootcamp에 없는 계층) |
| 파일 스토리지 | **MinIO** (메모 첨부, 영상 목데이터) | 동일 |
| 가상 엣지 (virtual-edge) | **Python 3.12 + aiomqtt + PyYAML** — 통신 규격 문서 기반 독립 구현 (shared 미사용) | 언어 동일 계열 |
| 배포 | **Docker Compose** (2차년도), Jenkins CI | 동일 |

## 2. 계층별 근거

### 프론트엔드 — Next.js 15 + React 19 + TypeScript + Tailwind
- AIBootcamp `web/`과 동일 구성. 라우트 그룹·역할 가드 미들웨어·HttpOnly 쿠키 세션(jose) 패턴을 그대로 가져온다.
- 디자인 전달본의 인라인 스타일은 Tailwind 기반 토큰(CSS 커스텀 프로퍼티 + Tailwind 테마 확장)으로 포팅한다 (`../design/design-change-spec.md` §6).
- 실시간 갱신은 WebSocket 클라이언트로 구독한다.

### 애플리케이션 서버 — Django 5.2 LTS + DRF + Channels
- AIBootcamp `api/`와 동일한 Django·DRF·SimpleJWT·drf-spectacular 구성.
- **로그인 시스템은 AIBootcamp의 인증 흐름을 재사용한다** — LocalAuthAdapter + SimpleJWT 발급 + HttpOnly 쿠키 + 프론트 미들웨어 역할 가드 (FR-31). 화면(로그인·권한별 라우팅)은 신규 제작이 필요하다 (`../design/design-change-spec.md` §3.1).
- WebSocket 푸시는 **Django Channels + Redis 채널 레이어**로 구현한다. 내부 MQTT 구독자(aiomqtt)가 수신한 메시지를 채널 레이어에 실어 웹앱으로 팬아웃한다.
- **내부 MQTT 구독 태스크는 반드시 단일 인스턴스로 띄운다.** ASGI 워커마다 구독 태스크가 뜨면 같은 메시지가 워커 수만큼 중복 push된다. 같은 Django 코드베이스의 별도 경량 프로세스(management command, 같은 컨테이너 내 보조 프로세스)로 1개만 실행하고, 수신 메시지를 Redis 채널 레이어에 실어 컨슈머들이 받게 한다. ASGI 워커(WebSocket·REST 담당)는 자유롭게 수평 확장한다.

### 미들웨어 서버 — FastAPI + aiomqtt
- 미들웨어 서버의 주 업무는 MQTT 수집·재발행·스케줄링으로, 요청-응답보다 **상시 비동기 IO**가 중심이다. Django보다 asyncio 네이티브인 FastAPI + aiomqtt가 적합하다.
- 내부 REST(이력·설정·명령 요청)는 FastAPI로 노출한다 (`communication-interface.md` §7). 외부 공개 없음.
- 언어를 Python으로 통일해 애플리케이션 서버와 모델·스키마 정의(pydantic)를 공유할 수 있다.

### DB — PostgreSQL 16 + TimescaleDB (OPN-03 해소)
- `EnvironmentReading`·`RobotStatus`는 고빈도 시계열, 나머지는 관계형 성격이다 (`../02-domain/data-model.md` §3). **PostgreSQL 단일 엔진에 TimescaleDB 확장을 얹어 시계열 테이블만 하이퍼테이블로** 두면, 별도 시계열 DB 없이 하이브리드 요구를 충족하고 AIBootcamp과 동일한 PostgreSQL 운영 경험을 재사용한다.
- 애플리케이션 서버 자체 저장소(계정·세션·메모)와 미들웨어 DB(원시·집계)는 **같은 PostgreSQL 인스턴스에 `app`/`mw` 스키마로 분리**한다 (OPN-15 확정 — `../02-domain/db-schema.md` §1). 소유권 = 마이그레이션 권한 = 접근 권한이며, DB 계정도 서비스별 분리해 상대 스키마 권한을 주지 않는다. 물리 분리는 부하 확인 후 재판단한다.

### MQTT 브로커 — Eclipse Mosquitto 2.x
- 경량이고 토픽 ACL을 지원해 설계 원칙 #2(애플리케이션 서버의 원시 토픽 구독 차단)를 강제할 수 있다 (`communication-interface.md` §2.2).
- 2차년도 규모(농장 1개·장치 수십 대)에 충분하다. 배치(미들웨어 컨테이너 동거 vs 별도 컨테이너)·TLS·인증 정책은 미정 (OPN-22 잔여).

## 3. 저장소·서비스 구성 (2차년도)

**모노레포**로 관리한다 — 저장소는 하나, 런타임은 서비스별 컨테이너로 분리. AIBootcamp(api/web 동거)와 같은 방식이다.

```
docker-compose
├─ web          Next.js 15                     (웹앱)
├─ api          Django 5.2 + Channels          (애플리케이션 서버)
├─ middleware   FastAPI + aiomqtt              (미들웨어 서버)
├─ virtual-edge Python + aiomqtt               (가상 엣지 — 팜 config 기반 데이터원)
├─ mosquitto    Eclipse Mosquitto 2.x          (MQTT 브로커)
├─ timescaledb  PostgreSQL 16 + TimescaleDB
├─ redis        Redis 7                        (Channels 레이어·캐시)
├─ minio        MinIO                          (첨부·영상 목데이터)
└─ nginx        단일 진입점 (/ → web, /api·/ws → api)
```

**경계 규칙 — 서비스 간 코드 import 금지.** 유일한 공유는 `shared/schemas/`(MQTT 메시지 pydantic 모델)이며 **middleware 만** 참조한다. virtual-edge 는 통신 규격 문서만으로 메시지를 독립 구현하고(계약 검증 목적), api·web은 내부 토픽/REST 계약으로만 통신한다. 이 경계를 지키면 추후 미들웨어를 별도 저장소로 분리할 때 디렉토리 추출만으로 가능하다.

## 4. 확정 필요 항목

- MQTT 브로커 배치·TLS·인증 정책 — OPN-22 (브로커 소프트웨어는 Mosquitto로 확정)
- 권한 분리 수준(역할 체계) — OPN-07 잔여 (인증 방식은 AIBootcamp 패턴으로 확정)

## 변경 이력
- 2026-07-29 · 최초 작성. 웹 스택을 AIBootcamp과 정합(사용자 결정), DB를 PostgreSQL 16 + TimescaleDB로 선정(OPN-03 해소), 브로커 Mosquitto 선정
