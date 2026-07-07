# 02-1 · 데이터 모델 (초안)

기능 요구사항에서 다루는 데이터를 엔터티 후보로 정리한다. 필드·타입은 DB 기술 스택 확정 후 정의한다.

## 1. 엔터티 후보

| 엔터티 | 내용 | 관련 기능 |
|---|---|---|
| RobotTaskLog | 로봇 작업 이력 (성공여부·작업량) | FR-01 |
| RobotStatus | 로봇 상태 (위치·속도·전원·이상, 실시간 스냅샷) | FR-04 |
| RobotSchedule | 로봇 임무·경로 스케줄 | FR-03 |
| RobotVideoAsset | 로봇 영상 데이터 (메타데이터, 원본은 별도 스토리지 참조) | FR-05, FR-09 |
| EnvironmentReading | 생육환경 센서값 (온도·습도·양분·조도·전력), 시계열 | FR-08 |
| GrowthAnalysis | 생육상태 분석 결과 (성장률·병충해유무·수확시기) | FR-09 |
| DeviceControlSetting | 생육기 제어 설정값 (수동/자동 구분) | FR-10, FR-11, FR-12, FR-21~26 |
| DataStatistics | 기간별 집계 결과 | FR-14 |
| FarmLog | 자동 생성 리포트 + 관리자 메모(사진/동영상 첨부) | FR-17, FR-18 |
| TaskSchedule | 생육기별 작업 스케줄 (양액·급수·방재 등) | FR-19, FR-20 |
| VoiceLog | 음성 메모·음성 명령 기록 | FR-27, FR-28, FR-29 |
| DeviceMeta | 로봇·생육기 등록 정보 | FR-07, FR-13 |
| User | 계정·권한 | 전체 |

## 2. 관계 개요

```
DeviceMeta ──┬── EnvironmentReading (생육기 1 : N)
             ├── RobotStatus (로봇 1 : N)
             ├── RobotVideoAsset
             └── DeviceControlSetting

User ──┬── FarmLog (작성)
        └── DeviceControlSetting (제어 요청)

EnvironmentReading, RobotStatus ──> DataStatistics (집계)
DataStatistics ──> FarmLog (자동 생성 리포트)
```

## 3. 확정 필요 항목

(README.md 참고)

- DB 기술 스택 (RDB / 시계열DB / 하이브리드) — OPN-03
- 각 엔터티의 정확한 필드·타입은 통신 규격 확정 후 함께 정의 — OPN-09

## 변경 이력
- 2026-07-07 · 최초 작성
