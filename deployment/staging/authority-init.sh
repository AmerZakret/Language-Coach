#!/bin/bash
set -euo pipefail
# Provision roles/schema on a NEW volume, never a deployment's authority row.
[[ "$POSTGRES_PASSWORD" =~ ^[0-9a-f]{64}$ ]]
[[ "$AUTHORITY_READER_PASSWORD" =~ ^[0-9a-f]{64}$ ]]
[[ "$AUTHORITY_OPERATOR_PASSWORD" =~ ^[0-9a-f]{64}$ ]]
[[ "$AUTHORITY_READER_PASSWORD" != "$AUTHORITY_OPERATOR_PASSWORD" ]]
[[ "$POSTGRES_PASSWORD" != "$AUTHORITY_READER_PASSWORD" ]]
[[ "$POSTGRES_PASSWORD" != "$AUTHORITY_OPERATOR_PASSWORD" ]]
psql -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE timeline_reader LOGIN PASSWORD '$AUTHORITY_READER_PASSWORD';
CREATE ROLE timeline_operator LOGIN PASSWORD '$AUTHORITY_OPERATOR_PASSWORD';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CONNECT ON DATABASE timeline_authority FROM PUBLIC;
GRANT CONNECT ON DATABASE timeline_authority TO timeline_reader,timeline_operator;
\i /authority/authority-schema.sql
SQL
