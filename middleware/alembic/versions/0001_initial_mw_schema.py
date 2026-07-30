"""mw 스키마 초기 마이그레이션 — db-schema.md §3 테이블 27개.

테이블 정의의 단일 소스는 middleware/app/models.py (SQLAlchemy Core) 이며,
본 마이그레이션은 metadata.create_all 로 그것을 그대로 반영한 뒤
TimescaleDB 하이퍼테이블 변환·압축 정책을 얹는다.

주의: retention policy(보존 기간)는 OPN-06 미결로 넣지 않는다 — 압축만 설정.
"""

from alembic import op

from middleware.app.models import HYPERTABLES, metadata

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    metadata.create_all(bind=bind)

    for table, cfg in HYPERTABLES.items():
        op.execute(
            f"SELECT create_hypertable('mw.{table}', 'ts', "
            f"chunk_time_interval => INTERVAL '{cfg['chunk']}')"
        )
        op.execute(
            f"ALTER TABLE mw.{table} SET ("
            f"timescaledb.compress, "
            f"timescaledb.compress_segmentby = '{cfg['segmentby']}', "
            f"timescaledb.compress_orderby = 'ts DESC')"
        )
        # 7일 경과 chunk 압축 (db-schema.md §5). 보존 정책은 OPN-06 확정 후 별도 리비전.
        op.execute(f"SELECT add_compression_policy('mw.{table}', INTERVAL '7 days')")


def downgrade() -> None:
    bind = op.get_bind()
    metadata.drop_all(bind=bind)
