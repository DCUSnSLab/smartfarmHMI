#!/bin/bash
# TimescaleDB 초기화 — 확장 + app/mw 스키마 + 서비스별 계정 (db-schema.md §1)
# 소유권 = 마이그레이션 권한 = 접근 권한: app_user 는 app 스키마만, mw_user 는 mw 스키마만.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS timescaledb;

    CREATE SCHEMA IF NOT EXISTS app;
    CREATE SCHEMA IF NOT EXISTS mw;

    CREATE ROLE app_user LOGIN PASSWORD '${APP_DB_PASSWORD:-app_dev}';
    CREATE ROLE mw_user  LOGIN PASSWORD '${MW_DB_PASSWORD:-mw_dev}';

    GRANT ALL ON SCHEMA app TO app_user;
    GRANT ALL ON SCHEMA mw  TO mw_user;
    ALTER ROLE app_user SET search_path = app;
    ALTER ROLE mw_user  SET search_path = mw;

    -- 상대 스키마 접근 차단 (읽기 포함 금지 — 설계 원칙 #2 의 DB 버전)
    REVOKE ALL ON SCHEMA mw  FROM app_user;
    REVOKE ALL ON SCHEMA app FROM mw_user;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
EOSQL
