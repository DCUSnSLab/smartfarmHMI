"""미들웨어 설정 — 환경 변수 기반 (pydantic-settings)."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # DB — mw 스키마 전용 계정 (db-schema.md §1)
    postgres_host: str = "timescaledb"
    postgres_port: int = 5432
    postgres_db: str = "smartfarm"
    mw_db_user: str = "mw_user"
    mw_db_password: str = "mw_dev"

    # MQTT
    mqtt_host: str = "mosquitto"
    mqtt_port: int = 1883

    # 통신 상태 판정 주기 (통신 규격 §5)
    conn_check_interval_sec: int = 10

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.mw_db_user}:{self.mw_db_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
