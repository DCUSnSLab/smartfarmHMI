SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help env up up-infra down restart logs ps build clean \
        api-shell mw-shell psql redis-cli mqtt-sub \
        migrate makemigrations health

help:
	@echo "smartfarmHMI — 개발 명령어"
	@echo ""
	@echo "기동/종료:"
	@echo "  make env               .env.example → .env 복사 (없을 때만)"
	@echo "  make up                전체 스택 기동"
	@echo "  make up-infra          인프라만 기동 (timescaledb·redis·minio·mosquitto)"
	@echo "  make down              전체 스택 종료"
	@echo "  make restart           재시작"
	@echo "  make logs              실시간 로그 (SVC=api 지정 가능)"
	@echo "  make ps                컨테이너 상태"
	@echo "  make build             이미지 재빌드"
	@echo "  make clean             컨테이너+볼륨 제거"
	@echo ""
	@echo "쉘:"
	@echo "  make api-shell         api 컨테이너 bash"
	@echo "  make mw-shell          middleware 컨테이너 bash"
	@echo "  make psql              timescaledb psql"
	@echo "  make redis-cli         redis-cli"
	@echo "  make mqtt-sub          브로커 전체 토픽 관찰 (T='farmon/#' 지정 가능)"
	@echo ""
	@echo "DB:"
	@echo "  make migrate           Django + Alembic 마이그레이션 (증분 1부터)"
	@echo ""
	@echo "검증:"
	@echo "  make health            전 서비스 헬스 일괄 확인"

env:
	@if [ ! -f .env ]; then \
	  cp .env.example .env; \
	  echo "✓ .env 파일을 생성했습니다. 필요 시 값을 수정하세요."; \
	else \
	  echo "✓ .env 가 이미 존재합니다."; \
	fi

up: env
	$(COMPOSE) up -d --build

up-infra: env
	$(COMPOSE) up -d timescaledb redis minio minio-init mosquitto

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart $(SVC)

logs:
	$(COMPOSE) logs -f $(SVC)

ps:
	$(COMPOSE) ps

build:
	$(COMPOSE) build $(SVC)

clean:
	$(COMPOSE) down -v --remove-orphans

# ---------------- 쉘 ----------------
api-shell:
	$(COMPOSE) exec api bash

mw-shell:
	$(COMPOSE) exec middleware bash

psql:
	$(COMPOSE) exec timescaledb psql -U $${POSTGRES_USER:-smartfarm} -d $${POSTGRES_DB:-smartfarm}

redis-cli:
	$(COMPOSE) exec redis redis-cli

T ?= \#
mqtt-sub:
	$(COMPOSE) exec mosquitto mosquitto_sub -t '$(T)' -v

# ---------------- DB ----------------
migrate:
	$(COMPOSE) exec api python manage.py migrate
	$(COMPOSE) exec middleware alembic upgrade head

makemigrations:
	$(COMPOSE) exec api python manage.py makemigrations $(APP)

# ---------------- 검증 ----------------
health:
	@ok=1; \
	echo "── infra ──"; \
	$(COMPOSE) exec -T timescaledb pg_isready -U $${POSTGRES_USER:-smartfarm} >/dev/null && echo "✓ timescaledb" || { echo "✗ timescaledb"; ok=0; }; \
	$(COMPOSE) exec -T timescaledb psql -U $${POSTGRES_USER:-smartfarm} -d $${POSTGRES_DB:-smartfarm} -tAc \
	  "select count(*) from information_schema.schemata where schema_name in ('app','mw')" | grep -q '^2$$' \
	  && echo "✓ schemas app/mw" || { echo "✗ schemas app/mw"; ok=0; }; \
	$(COMPOSE) exec -T redis redis-cli ping | grep -q PONG && echo "✓ redis" || { echo "✗ redis"; ok=0; }; \
	$(COMPOSE) exec -T mosquitto mosquitto_sub -t '$$SYS/broker/uptime' -C 1 -W 3 >/dev/null && echo "✓ mosquitto" || { echo "✗ mosquitto"; ok=0; }; \
	$(COMPOSE) exec -T minio mc ready local >/dev/null 2>&1 && echo "✓ minio" || { echo "✗ minio"; ok=0; }; \
	echo "── services ──"; \
	$(COMPOSE) exec -T api python -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:8000/health")' 2>/dev/null && echo "✓ api /health" || { echo "✗ api /health"; ok=0; }; \
	$(COMPOSE) exec -T middleware python -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:8001/health")' 2>/dev/null && echo "✓ middleware /health" || { echo "✗ middleware /health"; ok=0; }; \
	$(COMPOSE) ps edge-sim --format '{{.State}}' | grep -q running && echo "✓ edge-sim running" || { echo "✗ edge-sim"; ok=0; }; \
	curl -sf http://localhost:$${HOST_GATEWAY_PORT:-48080}/ >/dev/null && echo "✓ nginx → web" || { echo "✗ nginx → web"; ok=0; }; \
	curl -sf http://localhost:$${HOST_GATEWAY_PORT:-48080}/api/health >/dev/null && echo "✓ nginx → api" || { echo "✗ nginx → api"; ok=0; }; \
	[ $$ok -eq 1 ] && echo "── ALL OK ──" || { echo "── FAILED ──"; exit 1; }
