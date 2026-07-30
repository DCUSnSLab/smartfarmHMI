"""농장 선행 등록 — 팜 컨테이너 기동 **전에** 실행해야 한다.

birth 는 접속 시 1회 발행이므로, 미등록 상태에서 도착하면 FK 로 거부되고
장치가 재접속할 때까지 연결 상태가 복구되지 않는다 (README 발견 사항 #2).
"""

import os

import httpx

from conftest import FARMS

MW_BASE = os.environ.get("MW_BASE", "http://host.docker.internal:48001")


def main() -> None:
    with httpx.Client(base_url=MW_BASE, timeout=15) as client:
        for farm_id, meta in FARMS.items():
            r = client.post("/internal/farms", json={"farm_id": farm_id, **meta})
            r.raise_for_status()
            print(f"✓ 농장 등록: {farm_id} ({meta['name']})")


if __name__ == "__main__":
    main()
