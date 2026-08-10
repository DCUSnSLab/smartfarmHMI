import pytest

from middleware.app.region_lookup import coordinates_to_region


@pytest.mark.parametrize(
    ("latitude", "longitude", "region_code"),
    [
        (35.8362641, 128.3368282, "4784032000"),
        (37.2054787, 126.7696365, "4159131000"),
        (35.856011, 126.7681528, "5221041000"),
        (35.1889639, 128.0884222, "4817051500"),
    ],
)
def test_coordinates_to_region(
    latitude: float,
    longitude: float,
    region_code: str,
) -> None:
    result = coordinates_to_region(latitude, longitude)
    assert result["region_code"] == region_code


def test_coordinates_to_region_rejects_outside_korea() -> None:
    with pytest.raises(ValueError, match="대한민국 범위"):
        coordinates_to_region(0, 0)
