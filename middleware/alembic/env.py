"""Alembic 환경 — async 엔진(asyncpg), mw 스키마 전용.

mw_user 계정으로 접속하며(search_path=mw), version 테이블도 mw 스키마에 둔다.
app 스키마는 Django 소유이므로 여기서 절대 건드리지 않는다 (db-schema.md §1).
"""

import asyncio

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from middleware.app.config import settings
from middleware.app.models import metadata

target_metadata = metadata


def _configure(connection):
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table="alembic_version",
        version_table_schema="mw",
        include_schemas=True,
    )


def do_run_migrations(connection):
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


def run_migrations_online():
    asyncio.run(run_async_migrations())


run_migrations_online()
