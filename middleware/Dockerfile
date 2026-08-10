# syntax=docker/dockerfile:1.7
# 빌드 컨텍스트는 저장소 루트 — shared/(MQTT pydantic 모델)를 함께 담는다.

# ---- builder ----
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build
COPY middleware/pyproject.toml ./
RUN pip install --upgrade pip setuptools wheel \
 && pip install --prefix=/install --ignore-installed ".[dev]"

# ---- dev ----
FROM python:3.12-slim AS dev

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app TZ=Asia/Seoul

COPY --from=builder /install /usr/local

WORKDIR /app
COPY middleware /app/middleware
COPY shared /app/shared

EXPOSE 8001
CMD ["uvicorn", "middleware.app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]

# ---- prod ----
FROM python:3.12-slim AS prod

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app TZ=Asia/Seoul

RUN useradd -r -u 10001 appuser
COPY --from=builder /install /usr/local

WORKDIR /app
COPY middleware /app/middleware
COPY shared /app/shared
USER appuser

EXPOSE 8001
# --workers 1 고정: lifespan 이 MQTT 구독(ingest_loop)·통신 상태 감시를 띄우므로
# 워커가 2개면 같은 메시지를 두 번 수집하고 LWT·스케줄러가 충돌한다 (tech-stack.md
# 의 "단일 인스턴스 전제" — k8s replicas 1 과 짝을 이룬다).
CMD ["uvicorn", "middleware.app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
