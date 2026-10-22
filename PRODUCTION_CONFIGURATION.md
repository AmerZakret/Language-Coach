# Phase 8A production configuration contract

The offline 8A preflight validates configuration shape, not production readiness. It never
connects to MongoDB/providers, creates indexes, or verifies credential rotation.
Runtime topology/index/storage readiness is now enforced by Phase 8B below.
The remaining Phase 8 controls are still required before deployment.

## Backend

Use a supported Node runtime, install target-platform dependencies with `npm ci`,
then `npm run build`. Inject environment variables through the deployment's secret
and configuration mechanism. Production ignores the developer `.env` file.
Both `npm run validate:prod` and `npm run start:prod` require an externally supplied
`NODE_ENV=production`. The latter starts the compiled `dist/src/main.js` after the
same offline preflight; build success alone is not a readiness check.

| Variable | Production contract |
|---|---|
| `NODE_ENV` | Explicitly `production`; only development/test/production accepted |
| `MONGODB_URI` | Required valid `mongodb://` or `mongodb+srv://` URI; never hardcoded/logged |
| `JWT_SECRET` | Required cryptographically random secret, at least 32 characters and 12 distinct characters; defaults, placeholders, single-case/numeric-only and repeated values rejected |
| `PORT` | Optional; integer 1–65535, default 3000; binds all interfaces behind controlled ingress |
| `CORS_ORIGINS` | Required comma-separated browser origins, HTTPS, no wildcard, credentials, query, fragment or path; whitespace/trailing slash normalized |
| `UPLOAD_ROOT` | Required absolute persistent directory; filesystem root, temp/build/metadata directories rejected |
| `AI_ENABLED` | Explicit `true` or `false`; controls all Gemini calls |
| `GEMINI_API_KEY` | Required, non-placeholder when AI enabled; absent allowed when disabled |
| `GEMINI_MODEL` | Optional override; default `gemini-2.5-flash`; select/validate with provider before launch |
| `PRONUNCIATION_ENABLED` | Explicit `true` or `false`; independent of AI feedback |
| `PRONUNCIATION_SERVICE_URL` | Required explicit HTTP(S) base URL when pronunciation enabled; no credentials/query/fragment |

Generate JWT/key material using a cryptographically secure generator, not a
memorable phrase. Length/character checks cannot prove randomness. Do not place
keys in command arguments, source, tickets, screenshots, examples, or logs.

Disabled AI returns a safe 503 for new chat/writing generation and existing
deterministic fallback context/feedback for supplementary features. Completed
chat receipts can still replay their durable result; history/clear remain usable.
Disabled pronunciation returns safe 503 without calling the transcription service.
Development/test retain local endpoint and feature defaults; the example explicitly
disables providers until the developer configures them. Production cannot infer
enablement from a missing key. `PRONUNCIATION_PROVIDER` is legacy and unused.

### Explicit self-hosted exceptions

Only set these after reviewing the deployment's network boundary:

- `ALLOW_LOCAL_MONGODB=true`: permits explicitly configured loopback MongoDB
  (it must still be a transaction-capable replica set/sharded deployment).
- `ALLOW_LOCAL_ORIGINS=true`: permits explicitly listed local browser origins,
  including HTTP; it never enables wildcard CORS. Native/mobile no-Origin
  requests remain possible. CORS uses bearer JWTs, with credentials disabled.
- `ALLOW_LOCAL_PRONUNCIATION=true`: permits an explicitly configured loopback
  transcription service. Private non-loopback HTTP service URLs are supported;
  service authentication and resource limits are deferred to Phase 8E.

Overrides never supply missing values. Private/public DNS resolution and network
isolation remain operator responsibilities; this offline check does not resolve
hosts or prove topology. Use TLS for remote database/provider connections.

### Upload storage

Mount the same persistent upload root for write/serve/delete. Multiple backend
instances must share it. Preserve historical images during deployment and backup
the files consistently with MongoDB, including receipts. Keep runtime images out
of Git. The offline preflight checks paths only; runtime local storage checks are
described below. Free-space monitoring remains a later operational concern.

## Historical Mongo credential rotation — operator checklist

An early Git version exposed a Mongo credential. History is not rewritten here.
Treat that credential as compromised, even if current source reads the environment.

1. Create/rotate to a separate least-privilege application credential through the
   database operator's trusted control plane.
2. Replace deployment secrets and the ignored local backend `.env`; do not reuse
   the exposed credential in any environment.
3. Revoke the exposed credential and verify revocation through an authorized
   operator workflow. Audit access as appropriate; record evidence without values.
4. Run the offline preflight against the injected replacement configuration.
   A pass proves shape only, never remote revocation or credential validity.

`CREDENTIAL ROTATION VERIFIED BY CODE: NO`

`OPERATOR ACTION REQUIRED: YES`

Rotating `JWT_SECRET` separately invalidates outstanding JWTs. Coordinate that
change with clients; this phase adds no multi-key grace period or token revocation.

## Web release

Set `VITE_API_URL` to the deployment's explicit HTTPS backend base URL before
`npm run build`. No production domain is embedded in source. Every Vite build,
including custom modes, validates the URL and fails if it is absent/local/unsafe.
Development `npm run dev` may default to localhost. URLs cannot contain secrets,
queries or fragments; build-time `VITE_` values are public, never secret storage.

For a deliberate local/private self-hosted installation only,
`VITE_ALLOW_LOCAL_API=true` permits an explicit local/private endpoint (including
HTTP). It does not restore a missing-value fallback or permit remote public HTTP.
Serve the bundle through production HTTPS/static hosting with SPA fallback.

## Flutter release

Supply `--dart-define=API_URL=https://<your-backend-host>` to release builds.
The application checks before service/queue startup and on endpoint lookup;
missing/non-HTTPS/loopback/emulator/private LAN URLs fail release startup.
Debug builds keep their local defaults. No direct pronunciation URL exists in
Flutter: recording is sent to the configured backend's pronunciation route.
This is a release runtime guard, not a substitute for CI artifact validation.

Android main manifest includes Internet permission. iOS declares microphone use
for pronunciation. Configure final application IDs, platform signing and store
metadata before distribution; no store artifact was produced in this phase.

Android release never falls back to the debug key. Create ignored
`lingua_ai/android/key.properties` with operator-owned `storeFile` (absolute or
relative to `android/`), `storePassword`, `keyAlias`, `keyPassword`. Supply the
keystore out of band. Release tasks fail clearly when signing configuration is
missing. Keep that file/keystore/passwords out of Git. Debug builds need none of
these. iOS provisioning/signing likewise remains an operator requirement.

## Safe checks

- Backend: `npm run build`, then injected `NODE_ENV=production npm run validate:prod`
  (shell syntax varies); no connection or paid request occurs.
- Backend focused tests: `npm test -- --runInBand runtime-config` (build first).
- Web: `node --test test/production-config.test.cjs`, then build with an explicitly
  injected `VITE_API_URL`. Example/test domains are not deployment values.
- Flutter: `flutter test test/release_config_test.dart`, `flutter analyze`.

Startup emits only environment, port, feature flags, origin count, and configured
booleans. It excludes URI, JWT, provider keys, tokens, and upload path. Validation
errors identify fields/policies without echoing values or URI parser details.

## Phase 8B: database, indexes, health and shutdown

### Production startup and schema policy

Production disables Mongoose `autoIndex`, `autoCreate`, command buffering,
automatic receipt/barrier index creation, legacy flashcard-index removal, and
lesson catalog seeding. **VERIFY ONLY** is the sole production startup policy.
There is no automatic repair, destructive migration, duplicate-data cleanup or
index-provisioning switch. Development/test retain explicit receipt initialization
and existing catalog/legacy-index compatibility behavior.

Before deployment, an operator-controlled migration must provision collections,
catalog data and indexes using the schema definitions and the internal inventory
in `lingua_ai_backend/src/operations/index-inventory.ts`. Provision transactional
collections (including Community posts and chat history) before serving traffic,
particularly on sharded deployments. Back up and examine existing constraints and
duplicate data before changes; never delete/merge user data just to make startup
pass. Remove the obsolete unique flashcard `{userId,targetWord}` constraint only
through a separately reviewed operator migration after installing the correct
language-aware constraint. This task runs no production migration.

| Domain/collection | Correctness-critical unique key |
|---|---|
| users | `email` |
| lessons | `id` |
| progresses | `userId, lessonId` |
| flashcards | `userId, targetLanguage, targetWord` |
| flashcardoperations | `userId, operationId, operationType` |
| progressresets | `userId, operationId` |
| mutationreceipts (Community and AI) | `userId, operationType, operationId` |
| chatbarriers | `userId, targetLanguage` |

Readiness enumerates actual indexes and compares ordered keys, uniqueness, sparse/
partial-filter/collation options. Equivalent names are permitted. Missing/wrong
constraints, the legacy flashcard constraint, or any TTL on these protected
collections block readiness. Diagnostics contain only internal collection/index
identifiers and classified codes, never raw database errors or duplicate values.
Performance-only owner/history query indexes do not block startup. Receipt TTLs
and automatic receipt cleanup remain prohibited.

### Transaction and connection requirements

Use a transaction-capable MongoDB replica set or supported sharded cluster, never
a standalone instance. URI text is insufficient: readiness checks actual `hello`
metadata, session/wire capability, and performs an empty snapshot read within a
primary transaction, then aborts it. No domain write or transaction commit is
performed. Application credentials need the corresponding read/list-index/session
permissions in addition to normal application privileges. Shard-key compatibility
and deployment-wide transaction configuration remain operator responsibilities.

Initial production connection/server selection is bounded by
`READINESS_TIMEOUT_MS` with one connection attempt. Failure prevents startup.
Once connected, application bootstrap performs bounded preflight before listening.
If topology/index/storage checks fail, HTTP health routes remain available but
production business/static requests receive retryable 503 `BACKEND_NOT_READY`.
Transient loss after startup does not terminate the process. Connection lifecycle
events immediately invalidate cached readiness; successful bounded rechecks can
restore it after recovery or operator provisioning. No old probe result can
restore readiness after disconnect/shutdown invalidation.

### Health and local storage

- `GET /health`: compatibility liveness, retaining `{status,timestamp}`.
- `GET /health/live`: cheap process/event-loop liveness; no database, provider or
  filesystem calls.
- `GET /health/ready`: cached core readiness; 200 `ready` or 503 `not_ready`, with
  `database`, `transactions`, `indexes`, `uploads` statuses and `Cache-Control: no-store`.
  It returns no URI, upload path, secret, raw exception or index/data details.

Readiness checks run at startup, on reconnect and periodically, coalescing
concurrent work. Responses do not enumerate indexes. The total check deadline
and expiry of cached verification prevent permanent stale READY. Detection still
has bounded heartbeat/recheck latency; this is not per-request database proof.
Hung filesystem operations cannot be cancelled portably: they retain their
single-flight slot while health/shutdown stay bounded and fail closed.

Community uploads are always enabled in this version, so storage is always
required. Production requires a pre-created persistent root; readiness never
creates a missing production mount directory. It verifies real path/directory
containment, writes/flushes/closes/removes an exclusive random probe, and pins
successful root resolution for the process lifetime. Existing Community directory
escapes/non-directories fail readiness. Development may create its local root.
Probe failures mark NOT READY; catastrophic unlink/storage faults may still require
operator removal of a `.readiness-*.probe` artifact. No domain image cleanup occurs.

This verifies **local** storage only. It cannot prove that replicas share a mount,
that storage survives host replacement, or that backups are consistent. A single
instance needs persistent storage; multiple instances must share the same root.

AI and pronunciation readiness is configuration-gated by 8A. Gemini/Whisper are
not called for core health; temporary provider failure does not make otherwise
healthy core services unready. Provider failures retain their existing safe API
contracts. Deep pronunciation diagnostics belong to 8E.

### Shutdown and orchestrator contract

Nest handles SIGTERM/SIGINT. At shutdown, readiness becomes NOT READY, rechecks
stop, and new business requests receive 503 `SHUTTING_DOWN`. Health remains cheap
and visible during draining. In-flight HTTP/controller work, including upload and
provider operations, gets 80% of the configured window to complete. Disconnected
clients do not hide executing controller work from the drain. At that bound,
remaining HTTP connections are closed; Nest then disposes HTTP and closes Mongo
through its existing Mongoose lifecycle (no second manual connection close).
Repeated signals are handled by Nest; repeated programmatic closes are coalesced.

The total production-process watchdog covers a stuck drain/framework/database
disposal and exits with failure at `SHUTDOWN_GRACE_MS`. External providers are not
given new cancellation behavior here; work exceeding the window ends at the
process boundary. Completed transactions/receipts remain durable. No shutdown
hook deletes uploaded images or performs compensating business mutations; forced
termination retains Phase 7's documented orphan/uncertain-ack recovery limits.
SIGKILL cannot run graceful hooks.

| Variable | Default | Valid range (milliseconds) |
|---|---|---|
| `READINESS_TIMEOUT_MS` | 5000 | 100–30000 |
| `READINESS_RECHECK_MS` | 15000 | 1000–60000 |
| `SHUTDOWN_GRACE_MS` | 25000 | 1000–120000 |

Configure an orchestrator startup allowance for connection plus preflight time,
liveness against `/health/live`, and readiness against `/health/ready` (for example
every five seconds with a two-second HTTP timeout). Set termination grace above
the application window, including proxy routing propagation. Do not use liveness
to restart the backend for a transient database/provider outage. Provision schema
and the mount before rolling out traffic; do not bypass the application gate.
