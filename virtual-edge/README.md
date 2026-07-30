# virtual-edge — 가상 엣지 (연동 테스트 하네스)

실물 센서가 없는 2차년도에 미들웨어 연동을 검증하기 위한 **가상 엣지 컨테이너 프로젝트**.

기존 `edge-sim`(기본 개발 스택 내장)과 달리, 이 프로젝트는 **완전 외부의 격리된 환경**에서 실제 외부 장치와 동일한 경로로 시스템에 접속한다. **컨테이너 1개 = 팜 1개**이며, config YAML 하나로 팜의 센서·액추에이터 구성과 센서별 전송 주기를 정의한다.

## 설계 원칙

| 원칙 | 구현 |
|---|---|
| **완전 격리** | 자체 compose 프로젝트·네트워크. 메인 스택 네트워크에 가입하지 않고, **호스트 공개 포트(41883)를 경유**해 브로커에 접속 — 실제 LAN 위 외부 장치와 동일 경로 |
| **계약 독립 구현** | `shared/schemas`를 사용하지 않는다. [`vedge/contract.py`](./vedge/contract.py)가 `docs/03-architecture/communication-interface.md` **문서만을 근거로** 메시지를 구성한다 (근거 §를 주석으로 명시) — 실제 엣지팀이 문서로 구현하는 상황을 재현해 문서·구현 불일치를 검출 |
| **컨테이너 = 팜** | `VEDGE_CONFIG`로 팜 YAML 지정. compose에 서비스 블록 추가만으로 팜 증설 |
| **센서/액추에이터 분리** | 센서는 각자 독립 asyncio 태스크로 **자기 주기**에 맞춰 발행. 액추에이터는 command를 받아 센서 모델에 물리 결합 |

## 팜 구성 (컴팩트)

**센서 9종** — 주기는 config에서 센서별 지정 (hwaseong 기준):

| 센서 | 종류 | 주기 | 모델 |
|---|---|---|---|
| temp-a / hum-a | 온도·습도 | 5s | 일변화 사인 + 노이즈, 액추에이터 목표에 1차 지연 수렴 |
| ec-a / co2-a | 양분·CO₂ | 10s | 〃 |
| illum-a | 조도 | 15s | LED 출력 반영 |
| power-a | 전력 | 15s | **base + Σ(작동 중 액추에이터 부하)** — 물리 결합 |
| tank-{nutrient,water,pesticide}-lv | 탱크 수위 | 30s | 시간당 자연 감소 + 도저 작동 시 추가 소모 (단조 감소) |

**액추에이터 4종** (FR-10 제어 대상과 1:1) + 원격 전체 정지:

| 액추에이터 | command | 결합 |
|---|---|---|
| heater-a | set_temperature | temp-a 수렴 + 1.2kW 부하 |
| humidifier-a | set_humidity | hum-a 수렴 + 0.4kW 부하 |
| doser-a | set_ec | ec-a 수렴 + **양액 탱크 2%/회 소모** |
| led-a | set_led | illum-a 반영(%→klx) + 0.8kW 부하 |
| (전체) | remote_stop / release | 액추에이터 정지·재개 — **센서 발행은 계속** (모니터링 유지) |

command 처리: `command_id` 멱등(중복 시 completed 재응답) → ack accepted → 적용 → ack completed. 미지원 rejected — 통신 규격 §4.8.

## 사용법

**전제**: 메인 스택 기동 상태 (저장소 루트에서 `make up && make migrate && make seed`).

```bash
cd virtual-edge

# 농장 등록 (최초 1회 — 미등록 농장의 birth 는 FK 로 거부됨)
curl -X POST http://localhost:48001/internal/farms -H 'Content-Type: application/json' \
  -d '{"farm_id":"hwaseong","name":"화성 딸기 스마트팜","farm_type":"greenhouse","crop":"딸기"}'

make up            # 기본 팜(hwaseong) 기동 → 대시보드 스코프에 농장 추가됨
make up-multi      # 멀티팜 (hwaseong + jinju)
make logs SVC=farm-hwaseong
make down
```

원격 브로커 대상: `MQTT_HOST=<broker-host> MQTT_PORT=1883 make up` — env가 config보다 우선.

### 팜 추가하기

1. `configs/<farm>.yaml` 작성 (farm_id·센서·액추에이터·주기)
2. `docker-compose.yml`에 서비스 블록 추가 (`VEDGE_CONFIG`만 다름)
3. 미들웨어에 농장 등록 (위 curl) 후 기동

## 연동 테스트

```bash
make test          # 전 시나리오 자동 실행 (약 3~4분, 워밍업 90s 포함)
```

make가 4단계를 오케스트레이션한다 (pytest는 docker를 제어하지 않는다):

| phase | 상태 | 시나리오 |
|---|---|---|
| 1 | hwaseong 기동 | ① 등록+birth→online ② metrics 자기기술 보존(주기 확장 필드 포함) ③ 센서 9종 적재 ④ **센서별 주기 준수**(ts 간격 중앙값) ⑤ 제어 왕복(completed+수렴) ⑥ **멱등**(중복 command 재발행→탱크 추가 소모 없음) |
| 2 | +jinju 기동 | ⑦ 멀티팜 분리 적재·상호 무간섭 |
| 3 | hwaseong 강제 중단 | ⑧ LWT→해당 농장 전 장치 offline cascade, jinju 생존 |
| 4 | hwaseong 재기동 | ⑨ retained death 정리+birth→online 복귀 |

테스트도 **외부 관점** — 미들웨어 REST(48001)·DB(45432)의 호스트 공개 포트로만 검증한다.

## 계약 준수 근거 (communication-interface.md)

| 구현 | 근거 |
|---|---|
| 토픽 `farmon/v1/{farm}/{type}/{id}/{msg}` | §2.1 |
| telemetry·birth·death retain=true / ack retain=false / QoS1 | §3 |
| LWT 등록 + **재접속 직후 retained death 삭제** | §3 LWT 계약 |
| sensor_reading에 `sensor_id` 개별 식별 | §4.1 |
| ack accepted/completed 2단 구분 | §4.8 |
| birth metrics 자기기술 | §4.9 |
| remote_stop 수신 (엣지 command 토픽) | §4.6 |

## 발견 사항 (문서 개선 후보)

1. **birth의 `publish_interval_sec`가 장치 단위 단일 값** — 센서별 주기가 다른 장치를 표현할 수 없다. 본 구현은 최소 주기를 선언하고 `metrics[].interval_sec`를 확장 필드로 병행 발행했다 (§4 확장 허용으로 수용됨). 통신 상태 판정(§5)이 장치 단위 최소 주기로 동작하므로 실해는 없으나, **규격에 metrics별 주기 필드를 정식 추가**할 가치가 있다.
2. **미등록 농장의 텔레메트리 처리 정책 부재** — `environment_reading`(하이퍼테이블, FK 없음)은 미등록 farm_id도 적재되지만 `device_connection_state`(FK)는 거부된다. 등록 전 데이터의 수용/거부 정책을 문서에 명시할 필요 (현재: POST /internal/farms 선행 등록으로 회피).
3. **미등록 센서는 최신값 캐시가 갱신되지 않음** — `mw.sensor` 레지스트리에 없는 센서의 텔레메트리는 적재는 되나 스냅샷(sensors)에 나타나지 않는다. 장비 등록(FR-07·13) 구현 전까지의 알려진 제약.
