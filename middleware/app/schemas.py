"""여러 라우터가 함께 쓰는 REST 스키마.

농장을 쓰는 경로가 셋이다 — 생성(`POST /farms`), 부분 수정(`PATCH /farms/{id}`),
발견한 엣지를 농장으로 등록(`POST /discovery/{id}/register`). 셋의 필수·선택 모양은
서로 다르지만 **어느 것이든 farm 표의 같은 칸에 쓴다.**

그래서 공통 칸을 여기 모아 둔다. 각자 적어 두면 농장 항목을 하나 늘릴 때 세 곳을
모두 고쳐야 하고, 하나를 빠뜨리면 그 경로로 만든 농장만 그 값이 비어 버린다 —
화면에서는 「어떤 농장은 주소가 없다」로 보이고 원인은 등록 경로에 있다.

shared/schemas 와는 층이 다르다. 저쪽은 엣지와 주고받는 MQTT 계약이고, 이쪽은
앱서버가 부르는 내부 REST 의 본문이다.
"""

from pydantic import BaseModel


class FarmProfile(BaseModel):
    """농장을 설명하는 값 — 작물과 위치.

    전부 선택이다. 주소를 확정하기 전에도 농장을 만들 수 있어야 하고(좌표는 주소
    검색 뒤에 채워진다), 발견한 엣지를 급히 등록할 때도 이름만으로 성립해야 한다.
    """

    crop: str | None = None
    # 행정구역 코드 — 기상 조회가 이 값으로 격자를 찾는다
    region_code: str | None = None
    address: str | None = None
    zipcode: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    # 좌표를 어느 정밀도로 얻었나 (주소 검색 결과의 신뢰도)
    accuracy_m: float | None = None
