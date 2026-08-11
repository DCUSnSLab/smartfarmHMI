"""미들웨어 서버 엔트리포인트.

lifespan 에서 수집기(ingest_loop)·통신 상태 감시(connection_monitor)를 기동한다.
내부 재발행기는 증분 3, 커맨드 변환기는 증분 4 — component-internals.md §3.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.commands import timeout_watcher
from middleware.app.config import settings
from middleware.app.ingest import connection_monitor, ingest_loop
from middleware.app.republish import InternalPublisher
from middleware.app.weather import weather_collection_loop


def _setup_logging() -> None:
    """mw.* 로거에 핸들러를 단다.

    uvicorn 기본 로깅 설정은 uvicorn.* 로거만 구성하고 root 는 건드리지 않는다.
    그래서 이 함수가 없으면 애플리케이션 로그가 핸들러 없는 root 로 전파되어
    logging.lastResort(WARNING 이상, 포맷 없음)로만 새어 나간다 — log.info 는
    전부 유실된다. mw 로 한정해 붙여 다른 라이브러리 로깅은 건드리지 않는다.
    """
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s"))
    mw_log = logging.getLogger("mw")
    mw_log.handlers = [handler]
    mw_log.setLevel(settings.log_level.upper())
    mw_log.propagate = False


_setup_logging()

engine = create_async_engine(settings.database_url, pool_size=5)
publisher = InternalPublisher()


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = [
        asyncio.create_task(publisher.run(), name="republish"),
        asyncio.create_task(publisher.heartbeat(), name="health-beat"),
        asyncio.create_task(ingest_loop(engine, publisher), name="ingest"),
        asyncio.create_task(connection_monitor(engine, publisher), name="conn-monitor"),
        asyncio.create_task(timeout_watcher(engine, publisher), name="cmd-timeout"),
        asyncio.create_task(weather_collection_loop(engine), name="weather-collector"),
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
from middleware.app.settings_api import router as settings_router  # noqa: E402
from middleware.app.stop import router as stop_router  # noqa: E402

app.include_router(internal_router)
app.include_router(commands_router)
app.include_router(alerts_router)
app.include_router(stop_router)
app.include_router(settings_router)


@app.get("/health")
async def health():
    """헬스체크 — DB(mw 스키마 계정) + 브로커 연결까지 확인한다."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    async with aiomqtt.Client(settings.mqtt_host, settings.mqtt_port, timeout=3):
        pass  # 접속·해제만으로 브로커 생존 확인
    return {"status": "ok", "service": "middleware"}
