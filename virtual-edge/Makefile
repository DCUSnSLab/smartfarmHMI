SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help up up-multi down logs build test clean

help:
	@echo "virtual-edge — 가상 엣지 (연동 테스트 하네스)"
	@echo ""
	@echo "  make up          기본 팜(hwaseong) 기동"
	@echo "  make up-multi    멀티팜(hwaseong + gimje) 기동"
	@echo "  make down        전체 종료"
	@echo "  make logs        로그 (SVC=farm-hwaseong 지정 가능)"
	@echo "  make test        연동 테스트 전 시나리오 (메인 스택 기동 전제)"
	@echo ""
	@echo "  전제: 메인 스택이 실행 중이어야 함 (저장소 루트에서 make up·migrate·seed)"

up:
	$(COMPOSE) up -d --build farm-hwaseong

up-multi:
	$(COMPOSE) --profile multi up -d --build

down:
	$(COMPOSE) --profile multi --profile test down

logs:
	$(COMPOSE) logs -f $(SVC)

build:
	$(COMPOSE) --profile multi --profile test build

clean:
	$(COMPOSE) --profile multi --profile test down -v --remove-orphans

# 연동 테스트 — 단계를 make 가 오케스트레이션 (pytest 는 docker 를 제어하지 않는다)
#  phase1: 기본 (hwaseong)  phase2: 멀티팜 (+jinju)
#  phase3: LWT (hwaseong 중지)  phase4: 복구 (재기동)
test: build
	@echo "── phase 0: 농장 선행 등록 (birth 는 접속 시 1회 — 기동 전 등록 필수) ──"
	$(COMPOSE) run --rm test python tests/register_farms.py
	@echo "── phase 1·2 준비: 팜 2개 기동 ──"
	$(COMPOSE) --profile multi up -d --force-recreate farm-hwaseong farm-gimje
	@echo "── 워밍업 90s (저빈도 센서 표본 축적) ──"
	@sleep 90
	@echo "── phase 1: 기본 연동 (등록·birth·적재·주기·제어·멱등·로봇) ──"
	$(COMPOSE) run --rm test pytest tests -v --tb=short -m "not multi and not stop and not offline and not recover"
	@echo "── phase 2: 멀티팜 분리 ──"
	$(COMPOSE) run --rm test pytest tests -v --tb=short -m multi
	@echo "── phase 2.5: farm 스코프 정지 (스코프 격리 회귀) ──"
	$(COMPOSE) run --rm test pytest tests -v --tb=short -m stop
	@echo "── phase 3: LWT 오프라인 (hwaseong 강제 중단) ──"
	$(COMPOSE) kill farm-hwaseong
	$(COMPOSE) run --rm test pytest tests -v --tb=short -m offline
	@echo "── phase 4: 재접속 복구 ──"
	$(COMPOSE) up -d farm-hwaseong
	$(COMPOSE) run --rm test pytest tests -v --tb=short -m recover
	@echo "── 정리 ──"
	$(COMPOSE) --profile multi down
	@echo "✓ 연동 테스트 전 시나리오 통과"
