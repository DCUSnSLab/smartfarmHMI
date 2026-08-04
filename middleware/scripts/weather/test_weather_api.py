import json
from datetime import datetime, timedelta
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

from middleware.app.config import settings

API_URL = (
    "https://apis.data.go.kr/1360000/"
    "VilageFcstInfoService_2.0/getUltraSrtFcst"
)
KST = ZoneInfo("Asia/Seoul")

def get_base_datetime() -> tuple[str, str]:
    # 매시 30분 발표 자료를 40분부터 사용한다.
    target = datetime.now(KST)
    if target.minute < 40:
        target -= timedelta(hours=1)

    return (
        target.strftime("%Y%m%d"),
        target.strftime("%H30"),
    )


def main() -> None:
    base_date, base_time = get_base_datetime()

    # 우선 테스트용 기상청 격자 좌표
    nx = 60
    ny = 127

    params = {
        "serviceKey": settings.weather_key,
        "pageNo": 1,
        "numOfRows": 100,
        "dataType": "JSON",
        "base_date": base_date,
        "base_time": base_time,
        "nx": nx,
        "ny": ny,
    }

    url = f"{API_URL}?{urlencode(params)}"

    print("=== 기상청 API 요청 ===")
    print(f"base_date: {base_date}")
    print(f"base_time: {base_time}")
    print(f"nx: {nx}, ny: {ny}")
    print()

    # API 키는 출력하지 않음
    with urlopen(url, timeout=10) as response:
        body = response.read().decode("utf-8")

        print(f"HTTP status: {response.status}")
        print("=== 응답 ===")

        try:
            payload = json.loads(body)
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        except json.JSONDecodeError:
            print(body)


if __name__ == "__main__":
    main()