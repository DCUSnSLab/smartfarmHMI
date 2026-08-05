"""farm 위도·경도 전용 컬럼 추가 및 region_code 좌표 이관."""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE mw.farm ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION")
    op.execute("ALTER TABLE mw.farm ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION")
    op.execute(
        """
        UPDATE mw.farm
        SET latitude = split_part(region_code, '-', 1)::double precision,
            longitude = split_part(region_code, '-', 2)::double precision
        WHERE region_code ~ '^[0-9]{1,2}[.][0-9]{3}-[0-9]{2,3}[.][0-9]{3}$'
          AND split_part(region_code, '-', 1)::double precision BETWEEN 32 AND 40
          AND split_part(region_code, '-', 2)::double precision BETWEEN 123 AND 133
        """
    )
    op.execute("UPDATE mw.farm SET region_code = NULL")


def downgrade() -> None:
    op.execute(
        """
        UPDATE mw.farm
        SET region_code = to_char(latitude, 'FM00.000') || '-' ||
                          to_char(longitude, 'FM000.000')
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        """
    )
    op.execute("ALTER TABLE mw.farm DROP COLUMN IF EXISTS longitude")
    op.execute("ALTER TABLE mw.farm DROP COLUMN IF EXISTS latitude")
