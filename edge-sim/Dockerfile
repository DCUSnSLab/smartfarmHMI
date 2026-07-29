# syntax=docker/dockerfile:1.7
# 빌드 컨텍스트는 저장소 루트 — shared/(MQTT pydantic 모델)를 함께 담는다.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app:/app/edge-sim TZ=Asia/Seoul

WORKDIR /app
COPY edge-sim/pyproject.toml /build/pyproject.toml
RUN pip install --no-cache-dir /build

COPY edge-sim /app/edge-sim
COPY shared /app/shared

# 디렉토리명에 하이픈이 있어 -m 모듈 실행이 불가 — 경로 실행 (shared 는 PYTHONPATH=/app 로 import)
CMD ["python", "edge-sim/sim/main.py"]
