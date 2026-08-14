"""farm 주소와 우편번호 컬럼 추가."""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE mw.farm ADD COLUMN IF NOT EXISTS address TEXT")
    op.execute("ALTER TABLE mw.farm ADD COLUMN IF NOT EXISTS zipcode TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE mw.farm DROP COLUMN IF EXISTS zipcode")
    op.execute("ALTER TABLE mw.farm DROP COLUMN IF EXISTS address")
