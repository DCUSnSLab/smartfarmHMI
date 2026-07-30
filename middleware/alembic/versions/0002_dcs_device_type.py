"""device_connection_state 에 device_type 추가.

birth 가 자기기술하는 device_type 을 연결 상태에 보존한다.
원격 전체 정지(FR-35)의 명령 전달 대상(엣지 컨트롤러)을 장비 레지스트리
(device_meta — 사용자 등록)가 아니라 **birth 로 알려진 장치**에서 찾기 위함.
미등록 농장(가상 엣지 테스트 팜 등)에도 정지 명령이 전달되게 하는 수정
— virtual-edge 연동 테스트(farm 스코프 정지)가 발견한 갭.
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "device_connection_state",
        sa.Column("device_type", sa.Text(), nullable=True),
        schema="mw",
    )


def downgrade() -> None:
    op.drop_column("device_connection_state", "device_type", schema="mw")
