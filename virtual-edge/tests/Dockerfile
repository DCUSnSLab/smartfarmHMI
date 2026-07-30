FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Seoul
RUN pip install --no-cache-dir pytest pytest-asyncio httpx asyncpg "aiomqtt>=2.0,<2.4"
WORKDIR /app
CMD ["pytest", "tests", "-v", "--tb=short"]
