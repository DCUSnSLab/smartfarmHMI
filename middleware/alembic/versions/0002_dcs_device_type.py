"""device_connection_state 에 device_type 추가.

birth 가 자기기술하는 device_type 을 연결 상태에 보존한다.
원격 전체 정지(FR-35)의 명령 전달 대상(엣지 컨트롤러)을 장비 레지스트리
(device_meta — 사용자 등록)가 아니라 **birth 로 알려진 장치**에서 찾기 위함.
미등록 농장(가상 엣지 테스트 팜 등)에도 정지 명령이 전달되게 하는 수정
— virtual-edge 연동 테스트(farm 스코프 정지)가 발견한 갭.

멱등 주의: 0001 은 models.py 의 metadata.create_all 로 스키마를 만든다
(단일 소스 = 현재 모델). 현재 모델의 device_connection_state 는 이미
device_type 을 포함하므로, 깨끗한 DB 에서는 0001 직후 컬럼이 이미 존재한다.
따라서 본 리비전은 조건부(IF NOT EXISTS)로 추가해야 한다 — 그렇지 않으면
`alembic upgrade head` 가 DuplicateColumnError 로 전체 롤백된다.
(create_all 기반 baseline 뒤에 오는 모든 증분 ALTER 는 이 규칙을 따른다.)
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE mw.device_connection_state "
        "ADD COLUMN IF NOT EXISTS device_type TEXT"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE mw.device_connection_state "
        "DROP COLUMN IF EXISTS device_type"
    )
