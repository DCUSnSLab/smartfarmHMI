"""가상 엣지 ↔ 미들웨어 연동 테스트.

단계는 Makefile 이 오케스트레이션한다 (pytest 는 docker 를 제어하지 않는다):
- phase1 (기본): farm-hwaseong 기동 상태 — 등록·birth·적재·주기·제어·멱등
- phase2 (-m multi): farm-jinju 추가 기동 상태 — 멀티팜 분리
- phase3 (-m offline): farm-hwaseong 중지 상태 — LWT 오프라인 (jinju 는 생존)
- phase4 (-m recover): farm-hwaseong 재기동 상태 — 재접속 복구
"""

import asyncio
import statistics

import pytest

pytestmark = pytest.mark.asyncio

HW = "hwaseong"
GROWBED = "growbed-01"


async def wait_until(fn, timeout=60, interval=3, desc=""):
    """조건 폴링 — 연동 테스트의 유일한 대기 수단."""
    deadline = asyncio.get_event_loop().time() + timeout
    last = None
    while asyncio.get_event_loop().time() < deadline:
        last = await fn()
        if last:
            return last
        await asyncio.sleep(interval)
    raise AssertionError(f"시간 초과({timeout}s): {desc} — 마지막 값 {last!r}")


# ── phase 1: 기본 연동 (farm-hwaseong 기동 상태) ──────────────

async def test_1_farm_registration_and_birth(mw, registered_farms):
    """농장 등록 → birth → 장치 online + metrics 자기기술 보존 (§4.9)."""
    async def online():
        snap = (await mw.get(f"/internal/farms/{HW}/snapshot")).json()
        states = {c["device_id"]: c["state"] for c in snap["connections"]}
        return states if states.get("edge-01") == states.get(GROWBED) == "online" else None

    states = await wait_until(online, desc="edge·growbed online")
    assert states["edge-01"] == "online" and states[GROWBED] == "online"


async def test_1_birth_metrics_preserved(db, registered_farms):
    """birth metrics(센서 9종 + interval_sec 확장 필드)가 미들웨어에 보존."""
    row = await db.fetchrow(
        "SELECT birth_metrics FROM mw.device_connection_state "
        "WHERE farm_id=$1 AND device_id=$2", HW, GROWBED)
    assert row is not None
    import json
    metrics = json.loads(row["birth_metrics"]) if isinstance(row["birth_metrics"], str) \
        else row["birth_metrics"]
    ids = {m["sensor_id"] for m in metrics}
    from conftest import HWASEONG_SENSORS
    assert ids == set(HWASEONG_SENSORS)
    assert all("interval_sec" in m for m in metrics), "확장 필드 유실 — extra 미허용?"


async def test_2_telemetry_ingested(db, registered_farms):
    """센서 9종 전부 environment_reading 적재 (§4.1 sensor_reading)."""
    from conftest import HWASEONG_SENSORS

    async def all_ingested():
        rows = await db.fetch(
            "SELECT sensor_id, count(*) AS n FROM mw.environment_reading "
            "WHERE farm_id=$1 AND ts > now() - interval '2 minutes' "
            "GROUP BY sensor_id", HW)
        got = {r["sensor_id"] for r in rows}
        return got if got >= set(HWASEONG_SENSORS) else None

    got = await wait_until(all_ingested, timeout=90, desc="센서 9종 적재")
    assert got >= set(HWASEONG_SENSORS)


async def test_3_per_sensor_interval(db, registered_farms):
    """센서별 전송 주기 준수 — ts 간격 중앙값 ≈ 설정 주기 (±50%)."""
    # 저빈도(30s) 센서까지 표본이 쌓이도록 최근 3분 관찰
    checks = {"temp-a": 5, "ec-a": 10, "tank-nutrient-lv": 30}
    for sensor_id, expected in checks.items():
        rows = await db.fetch(
            "SELECT ts FROM mw.environment_reading "
            "WHERE farm_id=$1 AND sensor_id=$2 AND ts > now() - interval '3 minutes' "
            "ORDER BY ts", HW, sensor_id)
        assert len(rows) >= 3, f"{sensor_id}: 표본 부족 ({len(rows)}행) — 3분 이상 가동 필요"
        gaps = [(rows[i + 1]["ts"] - rows[i]["ts"]).total_seconds()
                for i in range(len(rows) - 1)]
        median = statistics.median(gaps)
        assert expected * 0.5 <= median <= expected * 1.5, \
            f"{sensor_id}: 주기 {expected}s 기대, 중앙값 {median:.1f}s"


async def test_4_control_roundtrip(mw, db, registered_farms):
    """제어 왕복 (§4.4·§4.8) — issued → accepted → completed + 값 수렴."""
    before = await db.fetchval(
        "SELECT value FROM mw.environment_reading "
        "WHERE farm_id=$1 AND sensor_id='temp-a' ORDER BY ts DESC LIMIT 1", HW)

    target = round(float(before) + 4.0, 1)  # 현재보다 확실히 높은 목표
    r = await mw.post(f"/internal/farms/{HW}/devices/{GROWBED}/control",
                      json={"command": "set_temperature", "params": {"target": target},
                            "issued_by": "vedge-test"})
    assert r.status_code == 200, r.text
    command_id = r.json()["command_id"]

    async def completed():
        row = await db.fetchrow(
            "SELECT status FROM mw.command_log WHERE command_id=$1", command_id)
        return row if row and row["status"] == "completed" else None

    await wait_until(completed, timeout=30, desc=f"{command_id} completed")

    async def converged():
        now = await db.fetchval(
            "SELECT value FROM mw.environment_reading "
            "WHERE farm_id=$1 AND sensor_id='temp-a' ORDER BY ts DESC LIMIT 1", HW)
        return now if float(now) > float(before) + 1.0 else None

    await wait_until(converged, timeout=60, desc="temp 목표 방향 수렴")


async def test_5_duplicate_command_idempotent(mw, db, registered_farms):
    """멱등 (§3) — 같은 command_id 재발행 시 재실행 없음 (탱크 소모로 검증)."""
    import aiomqtt, json, os

    # 도저 1회: 탱크 2% 소모. 같은 command_id 재발행 → 추가 소모 없어야 함
    r = await mw.post(f"/internal/farms/{HW}/devices/{GROWBED}/control",
                      json={"command": "set_ec", "params": {"target": 1.9}})
    command_id = r.json()["command_id"]

    async def done():
        row = await db.fetchrow(
            "SELECT status, payload FROM mw.command_log WHERE command_id=$1", command_id)
        return row if row and row["status"] == "completed" else None
    row = await wait_until(done, timeout=30, desc="set_ec completed")

    payload = row["payload"] if isinstance(row["payload"], dict) else json.loads(row["payload"])
    drain_before = await db.fetchval(
        "SELECT value FROM mw.environment_reading WHERE farm_id=$1 "
        "AND sensor_id='tank-nutrient-lv' ORDER BY ts DESC LIMIT 1", HW)

    # 브로커에 원문 그대로 재발행 (QoS1 중복 배달 모사) — 외부 관점 그대로 MQTT 사용
    async with aiomqtt.Client(os.environ.get("MQTT_HOST", "host.docker.internal"),
                              int(os.environ.get("MQTT_PORT", "41883"))) as client:
        await client.publish(f"farmon/v1/{HW}/growbed/{GROWBED}/command",
                             json.dumps(payload), qos=1)
    await asyncio.sleep(8)

    drain_after = await db.fetchval(
        "SELECT value FROM mw.environment_reading WHERE farm_id=$1 "
        "AND sensor_id='tank-nutrient-lv' ORDER BY ts DESC LIMIT 1", HW)
    # 자연 감소(1.5%/h → 8초에 0.003%)만 허용 — 재실행이면 2% 추가 하락
    assert float(drain_before) - float(drain_after) < 1.0, \
        f"중복 명령이 재실행됨: {drain_before} → {drain_after}"


# ── phase 2: 멀티팜 (farm-jinju 추가 기동 상태) ────────────────

@pytest.mark.multi
async def test_6_multifarm_isolation(db, registered_farms):
    """두 팜의 데이터가 farm_id 로 분리 적재 — 상호 간섭 없음."""
    async def jinju_ingested():
        n = await db.fetchval(
            "SELECT count(DISTINCT sensor_id) FROM mw.environment_reading "
            "WHERE farm_id='jinju' AND ts > now() - interval '2 minutes'")
        return n if n >= 5 else None

    await wait_until(jinju_ingested, timeout=90, desc="jinju 센서 5종 적재")

    # 분리 검증: jinju 센서 목록에 hwaseong 전용 센서가 섞이지 않음
    jinju_ids = {r["sensor_id"] for r in await db.fetch(
        "SELECT DISTINCT sensor_id FROM mw.environment_reading WHERE farm_id='jinju'")}
    assert "co2-a" not in jinju_ids  # jinju config 에는 co2 없음
    hw_states = {r["device_id"]: r["state"] for r in await db.fetch(
        "SELECT device_id, state FROM mw.device_connection_state WHERE farm_id=$1", HW)}
    assert hw_states.get("edge-01") == "online"  # 이웃 팜 기동이 기존 팜에 무영향


# ── phase 3: LWT 오프라인 (farm-hwaseong 중지 상태) ────────────

@pytest.mark.offline
async def test_7_lwt_offline_cascade(db):
    """엣지 강제 중단 → LWT death → 해당 농장 전 장치 offline. jinju 는 생존."""
    async def hw_offline():
        rows = await db.fetch(
            "SELECT device_id, state FROM mw.device_connection_state WHERE farm_id=$1", HW)
        states = {r["device_id"]: r["state"] for r in rows}
        return states if all(s == "offline" for s in states.values()) else None

    states = await wait_until(hw_offline, timeout=120, desc="hwaseong 전 장치 offline")
    assert set(states.values()) == {"offline"}

    jinju = await db.fetchval(
        "SELECT state FROM mw.device_connection_state "
        "WHERE farm_id='jinju' AND device_id='edge-01'")
    assert jinju == "online", "이웃 팜이 cascade 에 휘말림"


# ── phase 4: 재접속 복구 (farm-hwaseong 재기동 상태) ───────────

@pytest.mark.recover
async def test_8_reconnect_recovery(db):
    """재기동 → retained death 정리 + birth → online 복귀 (§3 LWT 계약)."""
    async def hw_online():
        rows = await db.fetch(
            "SELECT device_id, state FROM mw.device_connection_state WHERE farm_id=$1", HW)
        states = {r["device_id"]: r["state"] for r in rows}
        return states if all(s == "online" for s in states.values()) else None

    states = await wait_until(hw_online, timeout=60, desc="hwaseong online 복귀")
    assert set(states.values()) == {"online"}
