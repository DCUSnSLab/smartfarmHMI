# syntax=docker/dockerfile:1.7
# 빌드 컨텍스트는 저장소 루트 — shared/(MQTT pydantic 모델)를 함께 담는다.

# ---- builder ----
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build
COPY middleware/pyproject.toml ./
RUN pip install --upgrade pip setuptools wheel \
 && pip install --prefix=/install ".[dev]"

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
CMD ["uvicorn", "middleware.app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
