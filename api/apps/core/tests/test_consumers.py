import asyncio
import json

import pytest
import redis.asyncio
import redis.exceptions
from asgiref.sync import async_to_sync
from asgiref.testing import ApplicationCommunicator
from channels.layers import get_channel_layer
from django.conf import settings
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.auth import ACCESS_COOKIE
from apps.core.consumers import SYSTEM_GROUP, MonitorConsumer


class WsClient:
    def __init__(self, application, path: str, headers: list[tuple[bytes, bytes]]):
        self._comm = ApplicationCommunicator(
            application,
            {
                "type": "websocket",
                "path": path,
                "raw_path": path.encode(),
                "query_string": b"",
                "headers": headers,
                "subprotocols": [],
            },
        )

    async def connect(self, timeout: float = 3) -> bool:
        await self._comm.send_input({"type": "websocket.connect"})
        msg = await self._comm.receive_output(timeout)
        return msg["type"] == "websocket.accept"

    async def send_json(self, data) -> None:
        await self._comm.send_input({"type": "websocket.receive", "text": json.dumps(data)})

    async def receive_json(self, timeout: float = 3):
        msg = await self._comm.receive_output(timeout)
        assert msg["type"] == "websocket.send", f"기대와 다른 프레임: {msg}"
        return json.loads(msg["text"])

    async def disconnect(self, code: int = 1000) -> None:
        await self._comm.send_input({"type": "websocket.disconnect", "code": code})
        await self._comm.wait()

    async def wait(self) -> None:
        await self._comm.wait()


def _token() -> str:
    token = AccessToken()
    token["user_id"] = 1
    token["email"] = "test@example.com"
    token["name"] = "테스트"
    token["role"] = "admin"
    return str(token)


def _client() -> WsClient:
    return WsClient(
        MonitorConsumer.as_asgi(),
        "/ws/monitor",
        headers=[(b"cookie", f"{ACCESS_COOKIE}={_token()}".encode())],
    )


async def _group_members(group: str) -> set[bytes]:
    client = redis.asyncio.from_url(settings.REDIS_URL)
    try:
        return set(await client.zrange(f"asgi:group:{group}", 0, -1))
    finally:
        await client.aclose()


async def _purge(group: str, members: set[bytes]) -> None:
    if not members:
        return
    client = redis.asyncio.from_url(settings.REDIS_URL)
    try:
        await client.zrem(f"asgi:group:{group}", *members)
    finally:
        await client.aclose()


async def _frame(ws: WsClient, wanted: str, timeout: float = 5) -> dict:
    for _ in range(50):
        msg = await ws.receive_json(timeout=timeout)
        if msg.get("type") == wanted:
            return msg
    raise AssertionError(f"{wanted} 프레임이 오지 않았다")


def test_socket_timeout_must_exceed_brpop_timeout():
    layer = get_channel_layer()
    host = layer.hosts[0]

    assert host.get("socket_timeout") is not None, (
        "CHANNEL_LAYERS 에 socket_timeout 이 없다 — redis-py 기본값이 brpop_timeout 과 같다"
    )
    assert host["socket_timeout"] > layer.brpop_timeout, (
        f"socket_timeout({host['socket_timeout']}) 이 "
        f"brpop_timeout({layer.brpop_timeout}) 보다 크지 않다. "
        "BRPOP 이 반환하기 전에 읽기 타임아웃이 터진다"
    )


def test_receive_survives_empty_channel_queue():
    calls_until_regression_surfaces = 2

    async def scenario():
        layer = get_channel_layer()
        channel = await layer.new_channel()
        idle_sec = layer.brpop_timeout + 1.5

        for attempt in range(calls_until_regression_surfaces):
            try:
                await asyncio.wait_for(layer.receive(channel), timeout=idle_sec)
            except redis.exceptions.TimeoutError as exc:
                pytest.fail(
                    f"메시지가 없는 동안 {idle_sec}초를 못 버티고 redis 읽기 타임아웃이 났다 "
                    f"(호출 {attempt}회차, {exc}). socket_timeout 이 brpop_timeout 보다 "
                    "커야 한다 — CHANNEL_LAYERS 주석 참고"
                )
            except asyncio.TimeoutError:
                continue
            else:
                pytest.fail("아무도 발행하지 않은 채널에서 메시지를 받았다 — 전제가 깨졌다")

    async_to_sync(scenario)()


def test_consumer_subscribes_and_answers_ping():
    async def scenario():
        ws = _client()
        assert await ws.connect(), "핸드셰이크가 거부됐다"

        await ws.send_json({"action": "subscribe", "scope": "all"})
        assert (await _frame(ws, "subscribed"))["scope"] == "all"

        await ws.send_json({"action": "ping"})
        await _frame(ws, "pong")

        await ws.disconnect()

    async_to_sync(scenario)()


def test_group_registration_cleared_when_consumer_raises(monkeypatch):
    async def boom(self, content, **kwargs):
        raise RuntimeError("의도적 예외")

    async def scenario():
        before = await _group_members(SYSTEM_GROUP)

        ws = _client()
        assert await ws.connect()

        ours = await _group_members(SYSTEM_GROUP) - before
        assert len(ours) == 1, "connect 가 system 그룹에 가입하지 않았다"

        monkeypatch.setattr(MonitorConsumer, "receive_json", boom)
        await ws.send_json({"action": "subscribe", "scope": "all"})

        for _ in range(50):
            await asyncio.sleep(0.1)
            if not (ours & await _group_members(SYSTEM_GROUP)):
                break

        leftover = ours & await _group_members(SYSTEM_GROUP)
        try:
            assert not leftover, f"예외로 죽은 컨슈머의 그룹 등록이 남았다: {leftover}"
        finally:
            await _purge(SYSTEM_GROUP, ours)

        with pytest.raises(RuntimeError):
            await ws.wait()

    async_to_sync(scenario)()


def test_cleanup_failure_does_not_mask_original_error(monkeypatch):
    async def boom(self, content, **kwargs):
        raise RuntimeError("원래 원인")

    async def broken_disconnect(self, code):
        raise ConnectionError("정리 중 redis 실패")

    async def scenario():
        before = await _group_members(SYSTEM_GROUP)

        ws = _client()
        assert await ws.connect()

        ours = await _group_members(SYSTEM_GROUP) - before
        assert len(ours) == 1, "connect 가 system 그룹에 가입하지 않았다"

        monkeypatch.setattr(MonitorConsumer, "receive_json", boom)
        monkeypatch.setattr(MonitorConsumer, "disconnect", broken_disconnect)
        await ws.send_json({"action": "subscribe", "scope": "all"})

        try:
            with pytest.raises(RuntimeError, match="원래 원인"):
                await ws.wait()
        finally:
            await _purge(SYSTEM_GROUP, ours)

    async_to_sync(scenario)()
