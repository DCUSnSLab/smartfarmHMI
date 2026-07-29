# 웹앱 기반 스마트팜 HMI — 요구사항 명세서

RISE 피지컬 AI 기반 스마트농업 생태계 구축 사업 2차년도 중, 웹앱 기반 스마트팜 HMI 개발(프론트엔드 웹앱 + 애플리케이션 서버 + 미들웨어 서버 + 통신 규격)의 요구사항·설계 문서 모음이다.

## 문서 진입 순서

1. [00-overview.md](./00-overview.md) — 사업 배경, 개발 범위, 시스템 목표
2. [docs/01-requirements/functional.md](./docs/01-requirements/functional.md) — 기능 요구사항 (41개 기능)
3. [docs/01-requirements/non-functional.md](./docs/01-requirements/non-functional.md) — 품질 속성 (안전·페일세이프·통신 신뢰성·접근성 포함)
4. [docs/02-domain/data-model.md](./docs/02-domain/data-model.md) — 데이터 엔터티
5. [docs/03-architecture/system-architecture.md](./docs/03-architecture/system-architecture.md) — 시스템 구성
6. [docs/03-architecture/communication-interface.md](./docs/03-architecture/communication-interface.md) — 통신 규격 (MQTT 토픽·메시지 스키마)
7. [docs/03-architecture/component-mapping.md](./docs/03-architecture/component-mapping.md) — 기능별 컴포넌트(웹앱/애플리케이션 서버/미들웨어 서버) 책임
8. [docs/03-architecture/component-internals.md](./docs/03-architecture/component-internals.md) — 각 컴포넌트 내부 모듈 구성
9. [docs/04-roadmap/phase2-scope.md](./docs/04-roadmap/phase2-scope.md) — 2차년도 로드맵과 현재 개발 범위
10. [docs/design/README.md](./docs/design/README.md) — 디자인 전달본 (화면 구조·디자인 토큰)
11. [docs/design/design-change-spec.md](./docs/design/design-change-spec.md) — 디자인 변경 명세 (요구사항 정합화에 따른 후속 작업)

> 문서 번호(`00-`, `01-1` 등)는 파일 헤더의 표기이고, 위 목록은 읽는 순서다. 통신 규격이 시스템 구성 바로 다음에 오는 것이 이해하기 쉬워 `docs/03-architecture/communication-interface.md`(헤더상 03-2)를 6번에 두었으므로, 이후 `docs/03-architecture/component-mapping.md`(03-3)·`docs/03-architecture/component-internals.md`(03-4)와 번호 순서가 일치한다.

## 디렉토리 구조

```
/
├─ README.md                    ← 본 문서 (문서 색인 · 미해결 이슈 색인)
├─ 00-overview.md               ← 사업 배경 · 개발 범위
└─ docs/
   ├─ 01-requirements/
   │  ├─ functional.md
   │  └─ non-functional.md
   ├─ 02-domain/
   │  └─ data-model.md
   ├─ 03-architecture/
   │  ├─ system-architecture.md
   │  ├─ communication-interface.md
   │  ├─ component-mapping.md
   │  └─ component-internals.md
   ├─ 04-roadmap/
   │  └─ phase2-scope.md
   └─ design/
      ├─ README.md
      ├─ design-change-spec.md
      ├─ 팜온 스마트팜 HMI v3.dc.html        ← 디자인 원본
      ├─ 팜온 스마트팜 HMI v3 (단독실행).html ← 공유용 단일 파일
      └─ support.js                          ← 원본 실행 런타임
```

## 결정된 사항

이전까지 미해결이던 항목 중 확정된 것이다.

| ID | 결정 내용 | 관련 문서 |
|---|---|---|
| OPN-01 | **미들웨어 서버 ↔ 엣지 통신은 MQTT로 확정.** 로봇 내부가 ROS2를 쓰더라도 엣지가 ROS2↔MQTT 브리지 역할을 맡는다 | docs/03-architecture/communication-interface.md |
| OPN-12 | **애플리케이션 서버 ↔ 미들웨어 서버는 내부 MQTT 구독(실시간) + REST(이력·설정)로 확정.** 미들웨어가 정규화해 재발행한 내부 토픽만 구독하고, 엣지 원시 토픽은 직접 구독하지 않는다 | docs/03-architecture/system-architecture.md, docs/03-architecture/communication-interface.md |

## 미해결 이슈 색인

아직 결정되지 않은 항목이다.

| ID | 내용 | 관련 문서 |
|---|---|---|
| OPN-02 | 실제 엣지 연동 시점 및 방식 | 00-overview.md, docs/03-architecture/system-architecture.md |
| OPN-03 | DB 기술 스택 (RDB / 시계열DB / 하이브리드) | docs/02-domain/data-model.md, docs/03-architecture/component-internals.md |
| OPN-04 | 실시간성 목표 수치 (응답/화면 반영 지연 등) | docs/01-requirements/non-functional.md |
| OPN-05 | 동시 접속자 수 목표 | docs/01-requirements/non-functional.md |
| OPN-06 | 데이터 보존 기간·백업 정책 | docs/01-requirements/non-functional.md |
| OPN-07 | 인증 방식·권한 분리 수준 | docs/01-requirements/non-functional.md |
| OPN-08 | 가용성 목표 | docs/01-requirements/non-functional.md |
| OPN-09 | 데이터 엔터티 필드·타입 정의 (통신 규격 확정 후 진행) | docs/02-domain/data-model.md |
| OPN-10 | 통신 메시지 스키마 필드 리뷰 | docs/03-architecture/communication-interface.md |
| OPN-11 | 2차년도 데모 상세 시나리오 확정 | 00-overview.md, docs/04-roadmap/phase2-scope.md |
| OPN-13 | 다중 로봇 제어(FR-02) 담당 여부 (우리 팀 vs 엣지팀) | docs/01-requirements/functional.md, docs/03-architecture/system-architecture.md |
| OPN-14 | LED 파레트별 개별 제어 필요성 및 방식 (2차년도는 그룹/전체 제어로 진행) | docs/01-requirements/functional.md, docs/01-requirements/non-functional.md |
| OPN-15 | 애플리케이션 서버 자체 저장소와 미들웨어 서버 DB를 물리적으로 분리할지, 스키마만 나눌지 | docs/03-architecture/component-internals.md |
| OPN-16 | 생육기 단위 모니터링·제어 UI 구성 (자체 설계안을 제시했으나 확정 보류) | docs/design/design-change-spec.md, docs/01-requirements/functional.md |
| OPN-17 | 외부 기상 API 공급자 선정 (기상청 단기예보 등) | docs/01-requirements/functional.md, docs/03-architecture/communication-interface.md |
| OPN-18 | 원격 전체 정지(FR-35) 해제 권한 수준 | docs/01-requirements/non-functional.md, docs/01-requirements/functional.md |
| OPN-19 | 물리 비상정지 상태 취득 경로 — 엣지가 상태를 발행해 줄 수 있는지 엣지팀 협의 필요 | docs/01-requirements/functional.md, docs/03-architecture/communication-interface.md |
| OPN-20 | 알림 임계값 기본값·에스컬레이션 정책 | docs/01-requirements/functional.md |
| OPN-21 | 실시간 배치도 좌표계 원점·스케일 — 엣지팀 협의 필요 | docs/03-architecture/communication-interface.md, docs/02-domain/data-model.md |
| OPN-22 | MQTT 브로커 배치(미들웨어 내장 vs 별도)와 인증·TLS 정책 | docs/03-architecture/system-architecture.md, docs/03-architecture/component-internals.md |
| OPN-23 | 다농장 실운영 전환 시점 (2차년도는 농장 1개로 운영) | 00-overview.md, docs/04-roadmap/phase2-scope.md |

## 변경 이력

- 2026-07-07 · 최초 작성
- 2026-07-29 · 문서를 `docs/` 하위로 이동, 디자인 전달본 추가에 따른 색인·링크 정리. OPN-01·OPN-12 확정, OPN-16~23 추가
