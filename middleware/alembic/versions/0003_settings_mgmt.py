"""설정(팜·설비 관리) 기능 — actuator·pending_registration 신설 + device_meta CHECK 확장.

HMI 설정 화면에서 팜·센서·액추에이터를 등록/수정/삭제하고, 미등록이지만
데이터가 들어오는 팜을 "발견"해 등록하기 위한 스키마.

- actuator: 제어 대상(히터·가습기·양액기·LED). sensor/tank 와 동형(device_meta 1:1).
- pending_registration: 발견 버퍼. 미등록 팜/장치의 birth·telemetry 를 임시 보존.
- device_meta.device_type_check 에 'actuator' 추가.

멱등 주의(0002 규칙 계승): 0001 은 models.py 의 create_all 로 스키마를 만든다.
현재 models.py 에는 이미 두 테이블과 확장된 CHECK 가 반영돼 있어, 깨끗한 DB 에서는
0001 직후 이미 존재한다. 따라서 본 리비전은 모두 조건부(checkfirst / IF EXISTS)로
수행해 `alembic upgrade head` 가 어느 상태에서든 실패하지 않게 한다.
"""

from alembic import op

from middleware.app.models import actuator, pending_registration

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_DEVICE_TYPES_NEW = "'robot','growbed','tank','station','sensor','edge','actuator'"
_DEVICE_TYPES_OLD = "'robot','growbed','tank','station','sensor','edge'"


def _set_device_type_check(values: str) -> None:
    op.execute("ALTER TABLE mw.device_meta DROP CONSTRAINT IF EXISTS device_type_check")
    op.execute(
        "ALTER TABLE mw.device_meta ADD CONSTRAINT device_type_check "
        f"CHECK (device_type IN ({values}))"
    )


def upgrade() -> None:
    bind = op.get_bind()
    actuator.create(bind, checkfirst=True)
    pending_registration.create(bind, checkfirst=True)
    _set_device_type_check(_DEVICE_TYPES_NEW)


def downgrade() -> None:
    bind = op.get_bind()
    _set_device_type_check(_DEVICE_TYPES_OLD)
    pending_registration.drop(bind, checkfirst=True)
    actuator.drop(bind, checkfirst=True)
