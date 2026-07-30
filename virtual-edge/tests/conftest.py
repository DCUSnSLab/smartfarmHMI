"""연동 테스트 픽스처 — 전부 외부 관점 (호스트 공개 포트로만 접근).

- MW_BASE : 미들웨어 내부 REST (dev 에서 호스트 노출 48001)
- DB_DSN  : TimescaleDB (mw_user — 검증 조회용)
전제: 메인 스택이 기동·마이그레이션·시드 완료 상태.
"""

import os

import asyncpg
import httpx
import pytest
import pytest_asyncio

MW_BASE = os.environ.get("MW_BASE", "http://host.docker.internal:48001")
DB_DSN = os.environ.get("DB_DSN",
                        "postgresql://mw_user:mw_dev@host.docker.internal:45432/smartfarm")

FARMS = {
    "hwaseong": {"name": "화성 딸기 스마트팜", "farm_type": "greenhouse", "crop": "딸기"},
    "jinju": {"name": "진주 토마토 온실", "farm_type": "greenhouse", "crop": "토마토"},
}

# hwaseong config (configs/hwaseong.yaml)와 일치해야 하는 기대값
HWASEONG_SENSORS = {
    "temp-a": 5, "hum-a": 5, "ec-a": 10, "co2-a": 10,
    "illum-a": 15, "power-a": 15,
    "tank-nutrient-lv": 30, "tank-water-lv": 30, "tank-pesticide-lv": 30,
}


@pytest_asyncio.fixture
async def mw():
    async with httpx.AsyncClient(base_url=MW_BASE, timeout=15) as client:
        yield client


@pytest_asyncio.fixture
async def db():
    conn = await asyncpg.connect(DB_DSN)
    yield conn
    await conn.close()


@pytest_asyncio.fixture
async def registered_farms(mw):
    """농장 등록 (멱등) — 미등록 농장의 birth 는 FK 로 거부되므로 선행 필수."""
    for farm_id, meta in FARMS.items():
        r = await mw.post("/internal/farms", json={"farm_id": farm_id, **meta})
        assert r.status_code == 200, r.text
    return list(FARMS)
