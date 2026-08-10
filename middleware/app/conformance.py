"""계약 적합성 검사 — 느슨한 JSON 계약의 안전장치.

wire 포맷이 JSON 이고 모든 모델이 extra="allow" 라, **필드명 오타는 검증을
통과한다.** 엣지가 battery_pct 대신 battery_percent 를 보내면 battery_pct 는
기본값(None)으로 남고 battery_percent 는 extra 로 흡수되어, 에러도 경고도
없이 화면의 배터리만 비어버린다. IDL·codegen 이 없는 대신 이 두 가지를
수신 경계에서 잡는다.

① 버전 (§4) — major 불일치는 거부, minor 불일치는 경고 후 수용
② 미지 필드 — 선언 필드와 이름이 비슷하면 오타로 경고, 아니면 확장으로 기록

둘 다 (농장, 장치, 항목) 단위로 **1회만** 로그한다. 5초 주기 텔레메트리에서
같은 경고가 반복되면 로그가 곧 무의미해지기 때문이다.
"""

import difflib
import logging

from shared.schemas import CONTRACT_VERSION

log = logging.getLogger("mw.conformance")

# 이 이상 비슷하면 확장이 아니라 오기입으로 본다. 0.75 는 battery_percent↔
# battery_pct 는 잡고 heading_rad 같은 정상 확장 필드는 건드리지 않는 값.
TYPO_CUTOFF = 0.75

# 기록 상한 — 오작동 장치가 매번 다른 필드명을 뿜어도 메모리가 늘지 않게 한다.
SEEN_LIMIT = 500

_seen: set[tuple] = set()
_limit_warned = False


def _first_time(key: tuple) -> bool:
    """같은 항목을 두 번 로그하지 않는다. 상한을 넘으면 더 기록하지 않는다."""
    global _limit_warned
    if key in _seen:
        return False
    if len(_seen) >= SEEN_LIMIT:
        if not _limit_warned:
            _limit_warned = True
            log.warning("적합성 로그 상한(%d) 도달 — 이후 신규 항목은 기록하지 않는다", SEEN_LIMIT)
        return False
    _seen.add(key)
    return True


def _major(version: str) -> str:
    return version.split(".", 1)[0]


def check_version(msg) -> bool:
    """계약 버전 확인 — 수용 가능하면 True.

    major 가 다르면 구조 자체가 달라졌다고 보고 **거부**한다. minor 차이는
    extra="allow" 와 필드 기본값으로 흡수되므로 경고만 남기고 받는다 —
    여기서 버리면 농장 데이터가 통째로 끊기는 쪽이 더 위험하다.
    """
    version = getattr(msg, "version", "") or ""
    if version == CONTRACT_VERSION:
        return True

    device = getattr(msg, "device_id", "?")
    key = ("version", msg.farm_id, device, version)

    if _major(version) != _major(CONTRACT_VERSION):
        if _first_time(key):
            log.error(
                "계약 major 불일치로 거부: %s/%s version=%r (서버 %s) — 엣지 구현 갱신 필요",
                msg.farm_id, device, version, CONTRACT_VERSION,
            )
        return False

    if _first_time(key):
        log.warning(
            "계약 minor 불일치: %s/%s version=%r (서버 %s) — 수용하되 필드 확인 요망",
            msg.farm_id, device, version, CONTRACT_VERSION,
        )
    return True


def check_fields(msg) -> None:
    """선언되지 않은 필드 점검 — 오타와 의도적 확장을 구분해 1회씩 남긴다."""
    extra = msg.model_extra
    if not extra:
        return

    fields = type(msg).model_fields
    device = getattr(msg, "device_id", "?")

    for name in extra:
        if not _first_time(("field", msg.farm_id, device, msg.type, name)):
            continue
        near = difflib.get_close_matches(name, fields, n=1, cutoff=TYPO_CUTOFF)
        # 비슷한 선언 필드가 기본값 그대로면 = 그 필드가 안 채워졌다 = 오타.
        # 값이 들어와 있으면 둘 다 온 것이므로 정상 확장으로 본다.
        if near and getattr(msg, near[0], None) == fields[near[0]].default:
            log.warning(
                "필드명 오타 의심: %s/%s %s 에 '%s' — '%s' 오기입? 해당 값이 비어 있다",
                msg.farm_id, device, msg.type, name, near[0],
            )
        else:
            log.info("확장 필드 수용: %s/%s %s 에 '%s'", msg.farm_id, device, msg.type, name)


def inspect(msg) -> bool:
    """수신 메시지 적합성 일괄 점검 — 적재를 진행해도 되면 True."""
    if not check_version(msg):
        return False
    check_fields(msg)
    return True
