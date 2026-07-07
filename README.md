# 웹앱 기반 스마트팜 HMI — 요구사항 명세서

RISE 피지컬 AI 기반 스마트농업 생태계 구축 사업 2차년도 중, 웹앱 기반 스마트팜 HMI 개발(프론트엔드 웹앱 + 서버 + 통신 규격)의 요구사항·설계 문서 모음이다.

## 문서 진입 순서

1. [00-overview.md](./00-overview.md) — 사업 배경, 개발 범위, 시스템 목표
2. [01-requirements/functional.md](./01-requirements/functional.md) — 기능 요구사항 (31개 기능)
3. [01-requirements/non-functional.md](./01-requirements/non-functional.md) — 품질 속성
4. [02-domain/data-model.md](./02-domain/data-model.md) — 데이터 엔터티
5. [03-architecture/system-architecture.md](./03-architecture/system-architecture.md) — 시스템 구성
6. [03-architecture/communication-interface.md](./03-architecture/communication-interface.md) — 통신 규격
7. [04-roadmap/phase2-scope.md](./04-roadmap/phase2-scope.md) — 2차년도 로드맵과 현재 개발 범위

## 디렉토리 구조

```
/
├─ 00-overview.md
├─ 01-requirements/
│  ├─ functional.md
│  └─ non-functional.md
├─ 02-domain/
│  └─ data-model.md
├─ 03-architecture/
│  ├─ system-architecture.md
│  └─ communication-interface.md
└─ 04-roadmap/
   └─ phase2-scope.md
```

## 미해결 이슈 색인

아직 결정되지 않은 항목이다.

| ID | 내용 | 관련 문서 |
|---|---|---|
| OPN-01 | 서버-엣지 통신 프로토콜 확정 (WebSocket, ROS2 등 검토 중) | 03-architecture/communication-interface.md, 03-architecture/system-architecture.md |
| OPN-02 | 실제 엣지 연동 시점 및 방식 | 00-overview.md, 03-architecture/system-architecture.md |
| OPN-03 | DB 기술 스택 (RDB / 시계열DB / 하이브리드) | 02-domain/data-model.md |
| OPN-04 | 실시간성 목표 수치 (응답/화면 반영 지연 등) | 01-requirements/non-functional.md |
| OPN-05 | 동시 접속자 수 목표 | 01-requirements/non-functional.md |
| OPN-06 | 데이터 보존 기간·백업 정책 | 01-requirements/non-functional.md |
| OPN-07 | 인증 방식·권한 분리 수준 | 01-requirements/non-functional.md |
| OPN-08 | 가용성 목표 | 01-requirements/non-functional.md |
| OPN-09 | 데이터 엔터티 필드·타입 정의 (통신 규격 확정 후 진행) | 02-domain/data-model.md |
| OPN-10 | 통신 메시지 스키마 필드 리뷰 | 03-architecture/communication-interface.md |
| OPN-11 | 2차년도 데모 상세 시나리오 확정 | 00-overview.md, 04-roadmap/phase2-scope.md |

## 변경 이력

- 2026-07-07 · 최초 작성
