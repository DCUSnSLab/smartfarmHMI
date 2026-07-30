"""미들웨어 서버 엔트리포인트.

lifespan 에서 수집기(ingest_loop)·통신 상태 감시(connection_monitor)를 기동한다.
내부 재발행기는 증분 3, 커맨드 변환기는 증분 4 — component-internals.md §3.
"""

import asyncio
from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.commands import timeout_watcher
from middleware.app.config import settings
from middleware.app.ingest import connection_monitor, ingest_loop
from middleware.app.republish import InternalPublisher

engine = create_async_engine(settings.database_url, pool_size=5)
publisher = InternalPublisher()


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(publisher.run(), name="republish"),
        asyncio.create_task(ingest_loop(engine, publisher), name="ingest"),
        asyncio.create_task(connection_monitor(engine, publisher), name="conn-monitor"),
        asyncio.create_task(timeout_watcher(engine, publisher), name="cmd-timeout"),
    ]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await engine.dispose()


app = FastAPI(title="smartfarmHMI middleware", lifespan=lifespan)

from middleware.app.alerts import router as alerts_router  # noqa: E402
from middleware.app.commands import router as commands_router  # noqa: E402
from middleware.app.internal_api import router as internal_router  # noqa: E402
from middleware.app.stop import router as stop_router  # noqa: E402

app.include_router(internal_router)
app.include_router(commands_router)
app.include_router(alerts_router)
app.include_router(stop_router)


@app.get("/health")
async def health():
    """헬스체크 — DB(mw 스키마 계정) + 브로커 연결까지 확인한다."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    async with aiomqtt.Client(settings.mqtt_host, settings.mqtt_port, timeout=3):
        pass  # 접속·해제만으로 브로커 생존 확인
    return {"status": "ok", "service": "middleware"}
