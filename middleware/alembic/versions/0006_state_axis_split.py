"""한 칸에 두 축이 들어 있던 상태를 분리 (통신 규격 0.3, §4.2·§4.7).

`robot_status.mission_state` 는 `idle|moving|working|charging|error` 였다. 앞
넷은 **임무가 어디까지 갔나**(상태), `error` 는 **무엇이 틀어졌나**(사건)로 축이
다른데 한 칸을 나눠 쓰고 있었다. 그래서 이동 중 실패하면 `moving` 이 `error` 로
덮여 어느 구간에서 멈췄는지가 사라졌다 — 임무 재개 설계에 필요한 정보다.

- mission_state → phase 로 개명하고 `error` 값을 제거 (4값)
- 오류는 이미 있던 `error` JSONB 컬럼이 전담한다. 두 칸이므로
  `phase='moving'` 과 `error={...}` 가 동시에 성립한다
- 기존 `mission_state='error'` 행은 어느 단계였는지가 이미 소실됐다.
  `idle` 로 내리고 `error` 가 비어 있으면 표식을 채워 사실을 보존한다

`stop_event.detail` 은 물리 비상정지의 3값(engaged|released|unknown)을 담는다.
0.2 는 "확인해 보니 풀림"과 "확인하지 못함"이 같은 `false` 여서 엣지가 재시작하면
현장 래치가 눌린 채여도 서버가 해제로 봤다. `unknown` 은 정지로 판정하되(안전측)
화면에는 "현장 확인 필요"로 구분해 띄워야 하므로, 판정 결과와 별개로 원 보고를
남긴다. 사람이 읽는 `reason` 문구를 파싱하는 대신 기계가 읽을 자리를 만든다.
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_PHASE = "'idle','moving','working','charging'"
_MISSION_STATE = "'idle','moving','working','charging','error'"


def upgrade() -> None:
    # ── robot_status: mission_state → phase (+ error 값 제거) ──────────
    op.execute("ALTER TABLE mw.robot_status DROP CONSTRAINT IF EXISTS robot_mission_state_check")
    # 0001 이 create_all 이라 새 DB 는 이미 phase 다. 개명은 기존 DB 에서만 필요하다.
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT 1 FROM information_schema.columns "
        "             WHERE table_schema = 'mw' AND table_name = 'robot_status' "
        "               AND column_name = 'mission_state') THEN "
        "    ALTER TABLE mw.robot_status RENAME COLUMN mission_state TO phase; "
        "  END IF; "
        "END $$"
    )
    # 단계가 소실된 과거 행 — 오류였다는 사실만이라도 error 쪽에 남긴다.
    op.execute(
        "UPDATE mw.robot_status SET error = "
        "  jsonb_build_object("
        "    'code', 'legacy_unknown',"
        "    'message', '0.2 mission_state=error — 진행 단계가 기록되지 않음',"
        "    'severity', 'warning') "
        "WHERE phase = 'error' AND jsonb_typeof(error) IS DISTINCT FROM 'object'"
    )
    op.execute("UPDATE mw.robot_status SET phase = 'idle' WHERE phase = 'error'")
    # 제약도 create_all 이 이미 만들어 뒀을 수 있다.
    op.execute("ALTER TABLE mw.robot_status DROP CONSTRAINT IF EXISTS robot_phase_check")
    op.execute(
        f"ALTER TABLE mw.robot_status ADD CONSTRAINT robot_phase_check "
        f"CHECK (phase IN ({_PHASE}))"
    )

    # ── stop_event: 물리 비상정지 3값 원 보고 보존 ──────────────────────
    op.execute("ALTER TABLE mw.stop_event ADD COLUMN IF NOT EXISTS detail JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE mw.stop_event DROP COLUMN IF EXISTS detail")

    op.execute("ALTER TABLE mw.robot_status DROP CONSTRAINT IF EXISTS robot_phase_check")
    # upgrade 의 개명과 대칭 — 이미 mission_state 인 DB 에서 멈추지 않게 한다.
    op.execute(
        "DO $$ BEGIN "
        "  IF EXISTS (SELECT 1 FROM information_schema.columns "
        "             WHERE table_schema = 'mw' AND table_name = 'robot_status' "
        "               AND column_name = 'phase') THEN "
        "    ALTER TABLE mw.robot_status RENAME COLUMN phase TO mission_state; "
        "  END IF; "
        "END $$"
    )
    # 되돌릴 때는 오류가 있던 행을 다시 error 로 접는다 (진행 단계는 다시 소실).
    # error 는 SQL NULL 이 아니라 jsonb null 로 적재된다 — SQLAlchemy JSON 의
    # none_as_null 기본값이 False 라 파이썬 None 이 'null'::jsonb 가 된다.
    op.execute(
        "UPDATE mw.robot_status SET mission_state = 'error' "
        "WHERE jsonb_typeof(error) = 'object'"
    )
    op.execute("ALTER TABLE mw.robot_status DROP CONSTRAINT IF EXISTS robot_mission_state_check")
    op.execute(
        f"ALTER TABLE mw.robot_status ADD CONSTRAINT robot_mission_state_check "
        f"CHECK (mission_state IN ({_MISSION_STATE}))"
    )
