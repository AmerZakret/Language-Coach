# Application PostgreSQL foundation — M3-A

The running application still uses MongoDB. No business service, client, public
route, AppModule or authority implementation is wired to the new foundation.
Default application PG mode is disabled. M3-A creates no timeline control row,
allocates no authority timeline and enables no application PostgreSQL traffic.
Only synthetic disposable databases are accepted by this phase's configuration
and migration entry points. This is not an application cutover or M4 fence.

## Boundaries and source specification

`POSTGRESQL_MIGRATION_DESIGN.md`, including M2-R1 section17, remains the reviewed
schema specification. Its13 collection families map to17 application/operational
tables in lc_app/lc_meta. The six SQL files are the reviewed DDL, split at the
specified dependency boundaries; no public ObjectId is replaced by a UUID. The
schema has40 application indexes (17 PK,11 UNIQUE,12 secondary), eight domains
and seven immutable-history statement triggers. There are **no application
partial receipt indexes**; the design's partial indexes belong to the independent
authority and are deferred to M4. The integration suite tests partial uniqueness
in an isolated scratch fixture, without inventing a new domain index.

The independent authority remains a different PostgreSQL cluster/service,
credential identity, volume and restore scope. This new Compose project has no
authority volume, database, service or control-network connection. Two local
containers alone would not prove production-independent recovery. Object storage,
authority issuance/history/permits and every C2 implementation remain unchanged.

## Start the disposable database

From the repository root, using Docker Desktop's Linux engine:

```powershell
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json up -d --wait app-postgres
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json build tests
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json run --rm --no-deps tests
```

The example file contains only distinct, intentionally public synthetic fixture
passwords. Never reuse them or a real deployment's secrets. The pinned app server
is postgres:17.9-bookworm (same major/patch as the reviewed authority baseline),
with fsync/full_page_writes/synchronous_commit enabled,40 connections,64MB shared
buffers and container resource bounds. Image security/digest review for an actual
deployment remains separate; this is not a claim that17.9 is the latest patch.

The new project is `language-coach-m3a`; its private internal network and
`language-coach-m3a_app-data` volume are separate from11B staging. No DB port is
published by default. Bootstrap runs only on a **new** volume, provisions roles,
database identity attestation and global default function privileges, and creates
no application tables. Retained volumes are never wiped, reinitialized or adopted
by startup. Mismatched/partial provisioning refuses migration rather than repair.

Tests use a dedicated Linux dependency image built from the existing package lock
with install scripts disabled. Only foundation source, migrations and required
configuration files are mounted read-only; developer dotenv files, reports, clients,
authority code and credentials are not mounted. The test process runs as node with
all Linux capabilities dropped, no new privileges, and bounded /tmp tmpfs.
No network package installation runs in the private test network;
Windows node_modules native binaries are not used as Linux Jest dependencies.
Test fixtures create only generated lc_app_test_* databases in this new server;
failed targets remain evidence, and test teardown never drops databases/volumes.
The suite must be invoked explicitly; it is not silently skipped by default Jest.

## Explicit migrations and credentials

`lingua_ai_backend/migrations/application/manifest.json` records six ordered IDs,
raw LF SQL SHA-256 values, required predecessor, transaction mode, server/runtime
requirements and catalog seals. The runner checks exact file set/no symlinks,
target database marker, expected environment/storage/instance, role, primary and
server major before acquiring a bounded **app-only** advisory lock(110014,1).
It rechecks the manifest/files under that lock and executes immutable verified
SQL snapshots, rather than re-reading unchecked SQL later. The catalog must match
an approved prefix **before** identity/history rows are queried; forged views
cannot execute as preflight metadata. Wrong schema, checksum,
identity, unexpected objects, active runtime sessions or authority namespace
refuse. Role attribute, connection-limit and membership checks include inherited
privileges, not merely table ACLs. Unreviewed catalog object families fail closed.
The runner performs no authority/object/network calls while holding its lock.
The active-session check is a point-in-time guard, not the M4 writer fence;
closed/isolated intent remains an operator attestation in this disposable-only phase.

Role provisioning is an explicit administrator action outside schema migrations:

| Identity | Capability |
|---|---|
| lc_app_bootstrap | Synthetic cluster administrator; only fixture provisioning/test faults; never runtime |
| lc_app_owner NOLOGIN | Trusted schema owner; no login secret |
| lc_app_migrator NOINHERIT | Explicit SET ROLE owner only; separate LOGIN credential, no superuser/CREATEDB/CREATEROLE/replication |
| lc_app_runtime | Enumerated domain DML, complete receipt INSERT/SELECT; no control transition/DDL/history mutation |
| lc_app_reference | Post id/image_url and control/meta SELECT only; no password/receipt result access or row locking |
| lc_app_probe | Foundation schema/identity/control/catalog inspection only |
| lc_app_operator | Read-only operator evidence for now; M4 transition functions are absent |
| lc_app_audit | Protected explicit read-only data inspection; do not expose exports/hashes |

PUBLIC database CONNECT/TEMP and schema CREATE are revoked, with explicit role
CONNECT grants. Global owner function defaults revoke PUBLIC EXECUTE. Per-schema
default revocation alone cannot subtract global default execution privileges;
therefore bootstrap establishes the global restriction and the runner verifies
it. Existing functions additionally revoke PUBLIC explicitly in0006. Current role
attributes/membership and object owners/ACLs are checked; trusted administrators
can still defeat these controls and must be protected independently.

Each file and its history insert commit in one transaction. The first file
creates domains before history/identity; a separately parameterized, explicit
plan-bound identity insert happens in that transaction. Only committed successes
appear in history. A matching re-invocation performs no DDL; drift/future/gapped
history/invalid index/default privilege changes fail closed. There are no down,
DROP TABLE, TRUNCATE, automatic repair or startup migration actions. Unknown
COMMIT stops; inspect exact schema/history on a fresh connection before rerun.
Do not edit any applied SQL bytes or checksums; add reviewed migrations later.

For a manual synthetic runner invocation, build the backend (`npm run build`),
then set these values explicitly in the tool process; do not inherit a real URL:

```text
APPLICATION_PG_MODE=foundation-test
APPLICATION_PG_DISPOSABLE=true
APPLICATION_DATABASE_URL=postgresql://lc_app_migrator:<distinct-synthetic-password>@app-postgres/lc_app_m3a
APPLICATION_PG_ENVIRONMENT=synthetic-m3a
APPLICATION_PG_STORAGE_IDENTITY=synthetic-m3a-app
APPLICATION_PG_INSTANCE_ID=33333333-3333-4333-8333-333333333333
APPLICATION_PG_MIGRATION_REFERENCE=synthetic-reviewed-plan
```

For a copyable Windows invocation with the public synthetic example credentials,
run from the repository root (use a separate shell for fixture environment values):

```powershell
$env:APPLICATION_DATABASE_URL='postgresql://lc_app_migrator:synthetic-m3a-migrator-only@app-postgres/lc_app_m3a'
$env:APPLICATION_PG_MIGRATION_REFERENCE='synthetic-reviewed-plan'
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json run --rm --no-deps -e APPLICATION_DATABASE_URL -e APPLICATION_PG_MIGRATION_REFERENCE tests node -r /opt/m3a/node_modules/ts-node/register/transpile-only src/tooling/application-migrate-cli.ts apply --closed-isolated --approve-empty
```

The `-e NAME` form forwards environment values without putting a credential in
the Docker command arguments. Inside an already configured tools process, invoke:

```text
node -r /opt/m3a/node_modules/ts-node/register/transpile-only src/tooling/application-migrate-cli.ts apply --closed-isolated --approve-empty
```

The integration suite invokes that same migration API with the migrator role;
normal backend startup never invokes it. `--approve-empty` is an explicit
synthetic empty-target approval, not authorization to overwrite a nonempty DB.
Actual production provisioning, external isolation/current-authority evidence,
credentials/TLS, backup custody and a non-disposable mode require a later reviewed
phase; they cannot be enabled through this restricted M3-A runner. Credential
rotation must be a separately authorized administrator operation; changing the
example file does not rotate retained-volume roles or revoke existing sessions.

## Pool and transaction API

`src/persistence/application-database.ts` is an explicit reusable lifecycle provider
with `OnApplicationShutdown`, not a global module or per-request pool. Constructing
the disabled provider performs no connection. Explicit enabled construction owns
one bounded lazy pool; no business service imports it. Configuration rejects an
unsupported mode instead of choosing MongoDB as a fallback. Missing URLs cannot
fall back to inherited PGHOST/PGUSER. Allowed disposable hosts/databases and role
identities are constrained and every checkout verifies actual DB identity.

Defaults: max8 clients, pending admission16, acquire1s, statement5s, lock1s,
idle-in-transaction65s, total transaction75s and shutdown5s. Configurable bounds
use APPLICATION_PG_POOL_MAX/MAX_PENDING/ACQUIRE_MS/STATEMENT_MS/LOCK_MS/IDLE_TX_MS/
TRANSACTION_MS/SHUTDOWN_MS. Production capacity/provider budgets are not measured.
Future reference/probe pools need their own identities/capacity; M4 reserve/pool
graphs and all authority interactions are not implemented by this single-store
foundation.

`ApplicationTransactions.run(callback, options)` supplies a private WeakMap-bound
**FoundationTx**, with one checked-out client, explicit isolation/read-only mode,
transaction-local server settings and parameterized query values. It is not M2's
fenced WriteTx and grants no timeline admission. `query(handle,text,values)` rejects
foreign/completed/busy handles, nested transactions, transaction-control SQL and
concurrent statements. `inspect` is a separate READ ONLY operation and rejects
use inside a transaction. `withClient` is an internal infrastructure escape hatch
for tests/manager/diagnostics; never pass it or raw pg clients to business code.
No HTTP request is automatically wrapped and no global pool.query is exposed.
Before pooling a healthy client again, the provider rolls back any leftover
infrastructure transaction and resets role/session settings. Cleanup failures
discard the client and invalidate readiness without turning an acknowledged
commit into an automatically retried failure. SQL text is a trusted developer
constant; the usage whitelist is not a parser or a public arbitrary-SQL endpoint.

Callbacks must await their SQL and stop side effects on cancellation. The manager
rejects swallowed SQL failures before COMMIT, rolls back failures, invalidates the
handle and discards uncertain clients. It bounds the original deadline across
retries, uses PostgreSQL17 transaction_timeout and accepts AbortSignal. A timeout
cannot prove external provider work stopped. Connection loss/deadline during
COMMIT is UNKNOWN_COMMIT; no blind resend/new-key retry. Explicit database-only
retry requires sideEffects:none,1–12 attempts, known-aborted serialization/deadlock
only and the same absolute budget; arbitrary callbacks/external effects never
retry automatically. All SQL parameter/URI/error details stay out of safe errors.

`metrics()`/optional bounded-category diagnostic sink expose pool counts, failures,
last verified version and foundation readiness without users/SQL/parameters.
Health is read-only schema/identity verification, not M4 write admission, readiness
of the whole application or a new public route. Connection/config serialization
is redacted. Shutdown denies new acquisitions, drains bounded work and destroys
uncertain clients; watchdog expiry reports failure rather than a successful drain.

LC-PG-TEXT-1 helpers implement exact one-time backslash/NUL escaping with bounded
JSON own-property traversal and inert prototype keys. Dates/ObjectIds need future
field-aware public conversion before this JSON-only helper; undefined/missing,
explicit null, unsupported BSON and default projections are not heuristically
normalized. Required legacy metadata/field serializers, query-alias equivalence,
owner visibility and conversion parity remain M3-B/M5 domain work. No real backup
is converted here.

## Inspect using DBeaver or pgAdmin

Prefer an authenticated read-only audit identity. For optional local GUI access,
explicitly enable the **loopback-only** override (leave out for ordinary tests):

```powershell
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json -f deployment/application-postgres/compose.inspect.json up -d --wait app-postgres
```

Connect to127.0.0.1:15434, database lc_app_m3a, user lc_app_audit and its synthetic
example password. Never use authority credentials or a production saved connection.
Inspect lc_app/lc_meta and schema_migrations read-only. M3-A does not provision a
public GUI or publish0.0.0.0. The default manifest/instance identity is fixture-only.

## Safe stop and validation limits

For an **explicit fault test on a separately owned review project**, first start
and migrate/test `language-coach-m3a-r1` by adding `--project-name
language-coach-m3a-r1` to the setup commands. Then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File deployment/application-postgres/Test-Restart.ps1 -ProjectName language-coach-m3a-r1 -AllowDisposableRestart
```

This bounded probe verifies the synthetic database, waits for a real in-flight
statement, restarts only the named review PostgreSQL container, and requires
connection failure followed by readiness recovery with no leaked client. It
verifies the project label/data-volume name, never restarts the original M3-A or
staging projects, and keeps stdout/stderr in the ignored R1 artifact directory.
Do not use a restart fault as normal readiness repair. Missing Docker/SDK/socket
permissions must be reported or resolved with narrowly authorized execution;
timeouts, malformed/partial targets and failed recovery are not passing evidence.

```powershell
docker --context desktop-linux compose --env-file deployment/application-postgres/.env.example -f deployment/application-postgres/compose.json down
```

This stops/removes only this project containers/network and retains its dedicated
app-data volume as evidence. Do not use broad prune, down -v or remove any staging,
authority, user or object volumes. A new fixture can use a separately reviewed new
project/target; never auto wipe a failed retained target. Off-host backup/restore,
HA, promotion/WAL quorum, production-independent recovery and actual secrets
rotation/revocation are not proven by these local tests.

The explicit suite covers A–S foundation requirements with real PostgreSQL: schema,
checksum/idempotency/serialization, privileges/FKs/uniques/presence/IDs, rollback,
row locks/deadlocks/serialization retries, pool exhaustion/outage, shutdown,
timeouts/abort/unknown COMMIT, no startup migration, wrong authority/identity and
backend termination during DDL with exact-prefix recovery. Full old application
regressions remain separate repository quality commands. Evidence/results are in
`.release-validation/migration-m3-a/REPORT.md` and the independent corrective review
`.release-validation/migration-m3-a-r1/REPORT.md`; do not infer a pass from this list.

M4 lock order and timeline fencing runtime validation: **NO**. Upload/delete
recovery and storage reconciliation: **PARTIAL**. Authority anti-rollback:
**CONDITIONAL**. Global stale-writer fencing: **PARTIAL**. Full multi-instance
safety: **NO**. Historical exposed Mongo credential rotation and old credential
revocation: **NOT VERIFIED**, release blockers. No production traffic, store/public
release, real data migration, Mongo removal, M3-B, M4 or11B-D1 is authorized here.
