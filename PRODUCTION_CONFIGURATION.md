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

## Phase 8C: HTTP abuse and browser boundary

### Limits and deployment scope

The centralized limiter uses fixed windows and bounded in-process memory (20,000
active buckets). Identities are hashed with a random process-local salt. Expired
limiter buckets are not durable receipts: no receipt/schema/index/TTL policy changes.
Capacity exhaustion fails closed with 503 `ABUSE_CONTROL_UNAVAILABLE`; active limits
are never evicted. Process restart resets budgets; window boundaries permit bursts.
There is no permanent account lockout or account-existence lookup in the limiter.

Limits apply **per process**, not globally across replicas. A controlled single-instance
rollout needs controlled ingress. Multi-instance/internet-scale protection additionally
needs coordinated ingress/shared limits; no Redis/global-limit claim is made. Multiple
source IPs/stolen accounts remain risks. Retain upstream connection/slow-request limits
and restrict direct backend access.

| Route/category | Limits |
|---|---|
| Admitted non-health requests, including public/static/error requests (CORS preflight exempt) | IP 240/minute |
| Authenticated API requests | JWT owner 180/minute, plus IP ceiling |
| Login | IP 10/minute and 100/hour; process 300/minute |
| Register | IP 5/minute and 20/hour; process 100/minute |
| Guest creation | IP 3/minute and 20/hour; process 100/minute |
| Community create/edit/delete | Owner 20/minute; IP 60/minute |
| Community multipart create/edit | Additional owner 10/minute; IP 30/minute |
| Reactions | Owner 60/minute; IP 120/minute |
| Flashcard create/edit | Owner 30/minute before optional generation |
| Actual provider operations, all kinds combined | Owner 20/minute and 300/day; guest 5/minute and 30/day; IP 30/minute; process 120/minute |
| Actual provider operations by backend guests | Additional shared IP 10/minute across guest IDs |
| Per-kind provider owner limits | Chat 20/minute; writing 5/minute; flashcard context 10/minute; pronunciation feedback 10/minute; transcription 6/minute |
| Transcription provider operations | Additional IP 15/minute; process 30/minute |
| Exact `/health`, `/health/live`, `/health/ready` | Exempt; no authentication required |

Successful login never resets IP limits. JWT `sub` lookup supplies owner and actual
guest status; email/body/guest claims are not trusted. Local guests cannot access
protected routes. Another backend guest does not reset the shared IP provider budget.

Provider budgets are charged at actual invocation, after durable replay lookup.
Committed AI/flashcard replay does not spend provider budget again; ordinary
request/write ceilings still apply. Failed attempts and transaction retries that
actually reinvoke a provider consume budget. Respect 429 and Retry-After, retaining
the same logical operation ID. Existing offline clients classify 429 as retryable.
401 retains its authentication meaning.

AI concurrency: owner 2, registered IP 4 (guest IP 2), process 8. Transcription:
owner 1, IP 2, process 2. Permits span calls **and response parsing**; success,
failure and timeout rejection release them. Capacity fails fast with 429, no queue.
Before multipart buffering, Community holds owner 1/IP 2/process 4 HTTP permits;
pronunciation holds owner 1/IP 2/process 2. Supplementary pronunciation feedback
may use its existing fallback when budget/provider capacity is unavailable.
Unsettled calls retain slots to bound concurrency. Broader deadlines/circuit breakers
and Python inference concurrency remain later work. 8B shutdown bounds remain intact.

### Client IP and CORS

`TRUST_PROXY=false` defaults to the socket/Express peer: arbitrary X-Forwarded-For
does not change identity. Behind ingress, set an explicit comma-separated IP/CIDR
allowlist of **proxies only**, e.g. `10.20.0.0/24`. Blanket trust, hop counts, aliases
and `/0` are rejected. This does not discover networks: restrict direct reachability
and make trusted proxies overwrite/sanitize forwarded headers. Trusting client
networks permits spoofing; disabled trust behind a proxy shares its IP budget.

Production accepts exact configured CORS_ORIGINS. Unknown browser origins receive
403 `ORIGIN_NOT_ALLOWED` before controller work. No-Origin native/mobile requests
remain usable; development permits local origins. Preflight allows Authorization,
Content-Type, X-Idempotency-Key, X-Resource-Revision; Retry-After is exposed. Cookie
credentials remain disabled. CORS does not replace JWT auth or non-browser limits.

### Headers, caching and errors

Backend API/static responses use nosniff, no-referrer, X-Frame-Options DENY, CSP
`frame-ancestors 'none'`, no cross-domain policy and restrictive Permissions-Policy.
This is not the frontend document policy: do not copy the backend microphone-disabled
policy to the recording app. Express fingerprint headers are disabled. HSTS is not
sent on local HTTP; configure it at HTTPS ingress after validating HTTPS rollout.
Frontend document CSP/security headers remain its host's responsibility.

API/auth/personalized/error responses use Cache-Control no-store, including Community
likedByMe and AI/history/progress. Validated public raster uploads retain existing
static caching/content checks and nosniff; their IP ceiling still applies. Client
owner-scoped cache architecture remains unchanged.

The global filter returns only status, fixed safe code and fixed safe message.
Known mutation/revision/epoch/feature codes preserve status; unknown 5xx is generic.
Raw Mongo duplicate errors map to generic 409; provider failures to safe 502/503 or
existing supplementary fallbacks. No stack, raw exception/body, Mongo identifiers,
filesystem path, token, user ID, IP or secret is reflected/logged by the filter.
Its error log contains only fixed category/status. Validation returns bounded 400
VALIDATION_FAILED without reflected object/value/field dumps. 429 uses RATE_LIMITED
and Retry-After seconds, never bucket details. No broad request logging is added.

### Input/resource bounds

- JSON 32 KiB; URLencoded 16 KiB/50 parameters; compressed bodies rejected.
  Multipart retains separate byte/field/file bounds.
- AI message 500 characters; writing 1,000/topic 200; oversized content is rejected.
- Community text 1,000; feed page 1-10,000, limit 1-50 (no silent truncation).
  Existing image 5 MiB/16-million-pixel/decode restrictions remain.
- Flashcard word 100; translations 200; native-language label 64; example/note 500.
  These also bound optional generation context.
- Backend pronunciation audio 10 MiB; target 1,000, native translation 500,
  native-language label 64. Transcription text above 4,000 is a bad dependency result,
  rejected before similarity work. Python audio-duration/decoder/auth limits are 8E.
- Auth email 254/password 128; register/profile name 100.
- Gemini maxOutputTokens: chat 2,048; writing 4,096; flashcard 1,024; feedback 256.
  Raw provider bodies are never returned/logged.

Focused tests: `npm test -- --runInBand security` use disposable replica-set MongoDB,
signed JWT fixtures, temporary images and mocked providers only.
