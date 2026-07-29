"""미들웨어 서버 엔트리포인트.

증분 0(스캐폴딩): /health 만 제공한다.
증분 2 부터 lifespan 에 MQTT 구독 태스크(수집기)·내부 재발행기가 붙는다
— component-internals.md §3.
"""

from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.config import settings

engine = create_async_engine(settings.database_url, pool_size=5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 증분 2: 여기서 MQTT 구독 태스크 기동 (asyncio.TaskGroup)
    yield
    await engine.dispose()


app = FastAPI(title="smartfarmHMI middleware", lifespan=lifespan)


@app.get("/health")
async def health():
    """헬스체크 — DB(mw 스키마 계정) + 브로커 연결까지 확인한다."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    async with aiomqtt.Client(settings.mqtt_host, settings.mqtt_port, timeout=3):
        pass  # 접속·해제만으로 브로커 생존 확인
    return {"status": "ok", "service": "middleware"}
