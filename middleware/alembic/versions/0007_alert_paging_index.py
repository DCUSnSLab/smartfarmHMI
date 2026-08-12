"""전 농장 알림 목록의 키셋 페이지네이션용 인덱스.

기존 인덱스는 `(farm_id, occurred_at)` 뿐이라 농장 목록에는 쓰이지만 전 농장
목록(`/internal/alerts`)의 `ORDER BY occurred_at DESC, id DESC` 에는 쓰이지
않는다. 알림이 쌓이면 매 페이지가 전체 정렬을 다시 하게 된다.

DESC 인덱스를 만들지 않는 이유: btree 는 역방향 스캔이 가능해 같은 인덱스가
`ORDER BY ... DESC` 에도 쓰인다. 혼합 정렬이 아니라면 방향을 박을 이유가 없다.

새 DB 는 0001 의 `metadata.create_all` 이 models.py 선언으로 이미 만들므로
`IF NOT EXISTS` 로 건너뛴다 (0005·0006 과 같은 이유).
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_alert_occurred_id ON mw.alert (occurred_at, id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS mw.ix_alert_occurred_id")
