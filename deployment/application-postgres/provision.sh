#!/bin/sh
set -eu
# Entry-point bootstrap ONLY for the newly-created, dedicated disposable volume.
# PostgreSQL never re-executes this on a retained volume. Never use against authority.
for secret in "$POSTGRES_PASSWORD" "$M3A_MIGRATOR_PASSWORD" "$M3A_RUNTIME_PASSWORD" "$M3A_REFERENCE_PASSWORD" "$M3A_PROBE_PASSWORD" "$M3A_OPERATOR_PASSWORD" "$M3A_AUDIT_PASSWORD"; do
  case "$secret" in synthetic-m3a-?*) ;; *) echo 'Synthetic fixture credentials required' >&2; exit 1;; esac
  case "$secret" in *[!A-Za-z0-9-]*) echo 'Invalid synthetic credential characters' >&2; exit 1;; esac
  [ "${#secret}" -ge 20 ] && [ "${#secret}" -le 96 ]
done
[ "$(printf '%s\n' "$POSTGRES_PASSWORD" "$M3A_MIGRATOR_PASSWORD" "$M3A_RUNTIME_PASSWORD" "$M3A_REFERENCE_PASSWORD" "$M3A_PROBE_PASSWORD" "$M3A_OPERATOR_PASSWORD" "$M3A_AUDIT_PASSWORD" | sort -u | wc -l)" -eq 7 ] || { echo 'Distinct fixture credentials required' >&2; exit 1; }
[ "$POSTGRES_DB" = 'lc_app_m3a' ] && [ "$POSTGRES_USER" = 'lc_app_bootstrap' ]
psql -X --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=migrator="$M3A_MIGRATOR_PASSWORD" --set=runtime="$M3A_RUNTIME_PASSWORD" \
  --set=reference="$M3A_REFERENCE_PASSWORD" --set=probe="$M3A_PROBE_PASSWORD" \
  --set=operator="$M3A_OPERATOR_PASSWORD" --set=audit="$M3A_AUDIT_PASSWORD" <<'SQL'
CREATE ROLE lc_app_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE lc_app_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD :'migrator';
GRANT lc_app_owner TO lc_app_migrator;
CREATE ROLE lc_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 12 PASSWORD :'runtime';
CREATE ROLE lc_app_reference LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD :'reference';
CREATE ROLE lc_app_probe LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 1 PASSWORD :'probe';
CREATE ROLE lc_app_operator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD :'operator';
CREATE ROLE lc_app_audit LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2 PASSWORD :'audit';
ALTER DATABASE lc_app_m3a OWNER TO lc_app_owner;
-- Global defaults, not per-schema revocation: schema defaults can only add
-- privileges to global defaults. Existing functions also revoke PUBLIC in SQL.
ALTER DEFAULT PRIVILEGES FOR ROLE lc_app_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON DATABASE lc_app_m3a FROM PUBLIC;
GRANT CONNECT ON DATABASE lc_app_m3a TO lc_app_migrator,lc_app_runtime,lc_app_reference,lc_app_probe,lc_app_operator,lc_app_audit;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMENT ON DATABASE lc_app_m3a IS '{"purpose":"language-coach-application-foundation","database":"lc_app_m3a","environment":"synthetic-m3a","storageIdentity":"synthetic-m3a-app","databaseInstanceId":"33333333-3333-4333-8333-333333333333"}';
SQL
