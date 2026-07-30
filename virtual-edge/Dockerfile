# 가상 엣지 — 빌드 컨텍스트는 virtual-edge/ 디렉토리만 (모노레포 코드 의존 0)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app TZ=Asia/Seoul

RUN pip install --no-cache-dir "aiomqtt>=2.0,<2.4" "PyYAML>=6.0,<7"

WORKDIR /app
COPY vedge /app/vedge

CMD ["python", "-m", "vedge.main"]
