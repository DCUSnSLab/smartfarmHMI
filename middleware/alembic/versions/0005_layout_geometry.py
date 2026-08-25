"""엣지 자기기술 배치도를 담도록 layout_element·farm_layout 확장 (통신 규격 §4.9.1).

layout_element 는 element_type 에 'zone' 을 허용하면서 x·y 점 좌표만 갖고
있어 구역 폴리곤을 담을 자리가 없었다. 엣지가 SD 맵을 발행하기 시작하므로
도면을 그대로 보존할 수 있게 다음을 연다.

- geometry: 구역 폴리곤·게이트 선분 [[x,y], ...] (점 요소는 NULL)
- element_id: 엣지가 재발행할 때 통째로 교체하므로 (farm, element) 식별자가 필요
- gate·charging: gate 는 존 간 통로로 존·지점 어디에도 속하지 않는 제3의 요소.
  charging 이 없어서 충전 지점을 station 으로 접어 넣고 있었다
- zone / zone_type 분리: zone 컬럼은 "이 요소가 어느 존에 속하는가"를 담는
  자리다(0001 주석: "좌표 확정 전엔 NULL + zone 논리 배치"). 존 자신의 종류는
  zone_type 으로 따로 둔다 — 존과 지점은 다른 개념이고 관계는 포함이다
- farm_layout.source: 엣지 자기기술과 설정 화면 수기 등록을 구분
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

_TYPES = "'rack','station','tank','sensor','entrance','zone','gate','charging'"
_TYPES_OLD = "'rack','station','tank','sensor','entrance','zone'"


def upgrade() -> None:
    op.execute("ALTER TABLE mw.layout_element ADD COLUMN IF NOT EXISTS geometry JSONB")
    op.execute("ALTER TABLE mw.layout_element ADD COLUMN IF NOT EXISTS element_id TEXT")
    op.execute("ALTER TABLE mw.layout_element ADD COLUMN IF NOT EXISTS zone_type TEXT")
    # gate 는 두 존을 잇는다 — 어느 존들인지 보존한다.
    op.execute("ALTER TABLE mw.layout_element ADD COLUMN IF NOT EXISTS connects TEXT[]")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_element_layout_eid "
        "ON mw.layout_element (layout_id, element_id) WHERE element_id IS NOT NULL"
    )
    # 지점 → 소속 존 조회용.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_layout_element_zone "
        "ON mw.layout_element (layout_id, zone) WHERE zone IS NOT NULL"
    )
    op.execute("ALTER TABLE mw.layout_element DROP CONSTRAINT IF EXISTS layout_element_type_check")
    op.execute(
        f"ALTER TABLE mw.layout_element ADD CONSTRAINT layout_element_type_check "
        f"CHECK (element_type IN ({_TYPES}))"
    )

    # 자기기술 배치도의 출처를 남긴다 — 사람이 설정 화면에서 그린 것과 구분.
    op.execute("ALTER TABLE mw.farm_layout ADD COLUMN IF NOT EXISTS source TEXT")
    op.execute("ALTER TABLE mw.farm_layout ADD COLUMN IF NOT EXISTS source_device_id TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE mw.farm_layout DROP COLUMN IF EXISTS source_device_id")
    op.execute("ALTER TABLE mw.farm_layout DROP COLUMN IF EXISTS source")

    op.execute("DELETE FROM mw.layout_element WHERE element_type IN ('gate','charging')")
    op.execute("ALTER TABLE mw.layout_element DROP CONSTRAINT IF EXISTS layout_element_type_check")
    op.execute(
        f"ALTER TABLE mw.layout_element ADD CONSTRAINT layout_element_type_check "
        f"CHECK (element_type IN ({_TYPES_OLD}))"
    )
    op.execute("DROP INDEX IF EXISTS mw.ix_layout_element_zone")
    op.execute("DROP INDEX IF EXISTS mw.uq_layout_element_layout_eid")
    op.execute("ALTER TABLE mw.layout_element DROP COLUMN IF EXISTS connects")
    op.execute("ALTER TABLE mw.layout_element DROP COLUMN IF EXISTS zone_type")
    op.execute("ALTER TABLE mw.layout_element DROP COLUMN IF EXISTS element_id")
    op.execute("ALTER TABLE mw.layout_element DROP COLUMN IF EXISTS geometry")
