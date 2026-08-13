"""모니터링 컨슈머 회귀 테스트 (GEN-1323).

여기서 고정하는 것은 하나다 — **우편함이 조용해도 소켓이 살아 있어야 한다.**

이 조건이 깨졌던 적이 있고, 사람 눈으로는 잡히지 않았다. channels-redis 는 컨슈머의
메시지 대기를 `BRPOP <채널> 5` 로 구현하는데(brpop_timeout), redis-py 8.x 가
socket_timeout 기본값을 None 에서 5초로 바꾸면서 두 값이 같아졌다. BRPOP 이 빈 응답을
돌려주기 직전에 읽기 타임아웃이 터지고, 그 예외가 ASGI 앱 밖으로 나가 컨슈머가 죽는다.

증상이 숨는 방식이 고약하다.
  · 데이터가 5초 안에 계속 오면 BRPOP 이 먼저 반환해 아무 일도 없다 — 개발 중에는 안 보인다
  · 값이 조용히 끊긴 밤에만 드러난다. 실측으로 20시간에 그룹 멤버 4,505개까지 불었다
  · 서버의 disconnect() 로그는 0건이다(예외 경로라 호출 자체가 없다). 그래서 원인을
    「소켓이 닫히지 않고 누적된다」로 읽게 되고, 클라이언트 재연결 쪽을 파게 된다

즉 회귀했을 때 사람이 알아차릴 경로가 사실상 없다. 그래서 테스트로 잡는다.

async 테스트에 pytest-asyncio 를 쓰지 않는 이유: 설치돼 있지 않고, 이 테스트 몇 개를
위해 의존성을 늘릴 이유가 없다. `async_to_sync` 로 충분하다.
"""

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
    """최소 WebSocket 테스트 클라이언트.

    channels 가 제공하는 WebsocketCommunicator 를 쓰지 않는다. `channels.testing` 의
    __init__ 이 ChannelsLiveServerTestCase 를 통해 daphne 를 끌어오는데, 이 프로젝트는
    uvicorn 을 쓰므로 daphne 가 없다 (서브모듈만 가져와도 패키지 __init__ 이 먼저 돈다).
    import 하나를 위해 패키지를 늘리고 이미지를 재빌드할 값이 아니다 — 주고받을 프레임이
    네 종류뿐이라 직접 짠다. asgiref 는 Django 의 필수 의존성이라 새로 추가되는 것이 없다.
    """

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
        """앱이 끝나기를 기다린다 — 보관된 예외가 있으면 여기서 다시 던져진다."""
        await self._comm.wait()


def _token() -> str:
    """DB 없이 유효한 액세스 토큰을 만든다.

    컨슈머의 관문은 `user_from_token` 하나뿐이고 그것은 클레임만 읽는다(무상태 검증 —
    accounts/auth.py). 사용자 레코드를 만들지 않으므로 이 테스트들은 DB가 필요 없다.
    """
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
    """그룹에 등록된 채널 이름들 — 잔재 검사에 쓴다.

    채널 레이어의 내부 커넥션을 빌리지 않고 직접 읽는다. 잔재가 남는 경로는 컨슈머가
    예외로 죽는 경로이고, 그때 레이어 객체를 신뢰할 수 없다.
    """
    client = redis.asyncio.from_url(settings.REDIS_URL)
    try:
        return set(await client.zrange(f"asgi:group:{group}", 0, -1))
    finally:
        await client.aclose()


def test_socket_timeout_must_exceed_brpop_timeout():
    """설정 불변식 — 이 하나만 지키면 위 사고는 재발하지 않는다.

    값을 지우거나(기본값에 맡기거나) channels-redis 가 brpop_timeout 을 올리면 잡힌다.
    소켓을 열지 않으므로 빠르다.
    """
    layer = get_channel_layer()
    host = layer.hosts[0]

    assert host.get("socket_timeout") is not None, (
        "CHANNEL_LAYERS 에 socket_timeout 이 없다. redis-py 기본값(5초)이 적용되고, "
        "그것은 brpop_timeout 과 같아서 우편함이 빌 때마다 컨슈머가 죽는다"
    )
    assert host["socket_timeout"] > layer.brpop_timeout, (
        f"socket_timeout({host['socket_timeout']}) 이 "
        f"brpop_timeout({layer.brpop_timeout}) 보다 크지 않다. "
        "BRPOP 이 반환하기 전에 읽기 타임아웃이 터진다"
    )


def test_receive_survives_idle_mailbox():
    """조용한 우편함에서 receive() 가 redis 읽기 타임아웃으로 터지지 않아야 한다.

    이것이 사고의 정확한 기전이다.

    컨슈머를 세우지 않고 채널 레이어만 시험하는 이유는 격리다. 컨슈머를 세우면
    connect() 가 system 그룹에 가입해 브리지의 맥박(10초 주기)과 센서 데이터를 받게
    되고, 그러면 「우편함이 조용하다」는 전제가 주변 환경에 좌우된다 — 실제로 그렇게
    짰다가 브리지가 도는 동안 update 프레임을 받아 테스트가 엉뚱하게 실패했다.
    아무도 발행하지 않는 새 채널을 쓰면 우편함이 확실히 빈다.

    대기 시간을 상수로 박지 않고 레이어에서 끌어오는 이유: channels-redis 가
    brpop_timeout 을 올리면 이 테스트도 함께 따라가야 한다.

    **한 번만 불러서는 안 된다.** 새 레이어의 첫 receive() 는 회귀 상태에서도 살아남는
    것을 실측했다 (안쪽 BRPOP 이 5초에 실패해도 그 예외가 첫 호출에서는 표면화되지
    않는다). 실제 컨슈머는 await_many_dispatch 안에서 receive() 를 계속 다시 부르기
    때문에 즉사했다. 그 반복을 여기서도 재현한다.
    """
    attempts = 2

    async def scenario():
        layer = get_channel_layer()
        channel = await layer.new_channel()
        idle_sec = layer.brpop_timeout + 1.5

        for attempt in range(attempts):
            try:
                await asyncio.wait_for(layer.receive(channel), timeout=idle_sec)
            except redis.exceptions.TimeoutError as exc:
                pytest.fail(
                    f"빈 우편함에서 {idle_sec}초를 못 버티고 redis 읽기 타임아웃이 났다 "
                    f"(호출 {attempt}회차, {exc}). socket_timeout 이 brpop_timeout 보다 "
                    "커야 한다 — CHANNEL_LAYERS 주석 참고"
                )
            except asyncio.TimeoutError:
                continue   # 정상 — 메시지를 기다리는 중이었다. 우리가 그만둔 것이다
            else:
                pytest.fail("아무도 발행하지 않은 채널에서 메시지를 받았다 — 전제가 깨졌다")

    async_to_sync(scenario)()


async def _frame(ws: WsClient, wanted: str, timeout: float = 5) -> dict:
    """원하는 type 의 프레임이 올 때까지 실데이터(update)를 지나친다.

    브리지가 도는 환경에서는 구독 직후부터 센서·맥박이 섞여 들어온다.
    """
    for _ in range(50):
        msg = await ws.receive_json(timeout=timeout)
        if msg.get("type") == wanted:
            return msg
    raise AssertionError(f"{wanted} 프레임이 오지 않았다")


def test_consumer_subscribes_and_answers_ping():
    """컨슈머의 기본 왕복 — 구독 응답과 생존 확인(ping/pong).

    우편함이 조용한지는 보지 않는다(위 레이어 테스트가 본다). 여기서 고정하는 것은
    화면이 의지하는 두 계약이다 — 스코프 전환이 메시지로 되고(연결 교체가 아니라),
    맥박이 끊겼을 때 소켓 생존을 물어볼 수 있다는 것.
    """

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
    """예외로 끝난 컨슈머가 그룹 등록을 남기지 않아야 한다.

    Channels 의 AsyncConsumer.__call__ 은 StopConsumer 만 삼키고 나머지 예외는 ASGI 앱
    밖으로 흘린다. 그 경로에서는 disconnect() 가 아예 불리지 않아 **소켓은 닫히는데 그룹
    등록만 group_expiry(24시간) 동안 남는다.** 잔재는 살아 있는 연결과 프로세스 접두를
    공유하므로 우편함(capacity 100)을 함께 먹는다 — 실측으로 브리지가 over capacity 를
    뱉는 지점까지 갔다.

    위 socket_timeout 수정으로 이 경로를 타는 예외는 사라졌지만, 「예외 = 조용한 누수」
    라는 구조는 컨슈머가 어떤 이유로 죽어도 성립한다. 그래서 원인이 아니라 구조를 잡는다.
    """

    async def boom(self, content, **kwargs):
        # redis 읽기 타임아웃이 터지던 자리와 같다 — await_many_dispatch 안쪽
        raise RuntimeError("의도적 예외")

    async def scenario():
        before = await _group_members(SYSTEM_GROUP)

        ws = _client()
        assert await ws.connect()

        joined = await _group_members(SYSTEM_GROUP)
        assert len(joined - before) == 1, "connect 가 system 그룹에 가입하지 않았다"

        monkeypatch.setattr(MonitorConsumer, "receive_json", boom)
        await ws.send_json({"action": "subscribe", "scope": "all"})

        # 예외가 앱 밖으로 나가 정리가 끝나기를 기다린다. 통신기는 그 예외를 보관해
        # 두었다가 다시 던지므로 여기서 삼킨다 — 검사 대상은 예외가 아니라 잔재다.
        for _ in range(50):
            await asyncio.sleep(0.1)
            if not (await _group_members(SYSTEM_GROUP)) - before:
                break

        leftover = (await _group_members(SYSTEM_GROUP)) - before
        assert not leftover, (
            f"예외로 죽은 컨슈머의 그룹 등록이 남았다: {leftover}. "
            "group_expiry(24시간) 동안 살아 있는 연결의 우편함을 함께 먹는다"
        )

        # 예외 자체는 흘러나가는 것이 맞다 — 삼키면 uvicorn 로그에서 원인이 사라진다.
        # 안전망은 정리만 하고 다시 던진다는 것을 여기서 함께 고정한다.
        with pytest.raises(RuntimeError):
            await ws.wait()

    async_to_sync(scenario)()
