# Phase 8A production configuration contract

This preflight validates configuration shape, not production readiness. It never
connects to MongoDB/providers, creates indexes, or verifies credential rotation.
Runtime topology/index/storage readiness and the remaining Phase 8 controls are
still required before deployment.

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
of Git. Phase 8A checks paths only: permissions, disk space, real mount/symlink
resolution and readiness probes remain Phase 8B work.

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
