# Release packaging and promotion checklist

This contract separates **ARTIFACT** (reviewed code/build output), **CONFIG**
(externally injected endpoints/secrets), **STATE** (Mongo domain data, receipts,
epochs/barriers, uploads and provisioned model cache), and **OPERATOR ACTION**
(rotation/revocation, signing, DNS/TLS, indexes and restore evidence). Passing an
artifact check authorizes none of those operator actions or production traffic.

## Inventory and decisions

Before 9E, the backend build produced 97 JS modules plus maps/declarations,
including the lesson-replacement script and progress audit tools. The web emitted
an approximately 516 kB main JS chunk, static assets/sounds and `release.json`,
without maps. Flutter used placeholder platform IDs and required explicit release
signing. Pronunciation had four runtime source/dependency files, a separate test
suite and operator-provisioned model files. These are the audited starting facts;
they are not a permanent expected file count.

`release-policy.json` now specifies allowed categories. No operator tool is deleted.
Backend `npm run build` compiles source (including the separately invoked audit
CLI) into `dist/src`, without declarations or source maps. Ordinary build output
is **not** the deploy artifact. The narrow runtime package is assembled separately.

| Component | Allowed artifact | Excluded/provisioned separately |
| --- | --- | --- |
| Backend | `dist/src` JS in reviewed runtime directories/root modules; validated start/config launchers; runtime package/lock metadata; `release-manifest.json` | Specs/tests/fixtures, tooling/audit/repair CLI, lesson replacement/generation, declarations/maps/build info, `.env`, uploads, dependencies copied from a developer machine |
| Web | Built `index.html`, hashed JS/CSS/static assets and source sounds, `release.json`, `release-manifest.json` | Source, tests, environment files, maps, private service/provider configuration |
| Flutter | Operator-built signed AAB/APK/IPA after identity/config/signing review | Keystores, passwords, provisioning credentials, debug signing, local stores/audio/caches; no signed package is produced by repository quality CI |
| Pronunciation | `main.py`, `config.py`, `audio.py`, `requirements.txt`, `requirements-installer.txt`, generated manifest | Tests/dev requirements/lock inputs/docs/env files, bytecode/venv, audio/temp files, models/cache/weights; provision dependencies/model outside this source artifact |

The assembler refuses an existing destination, validates before writing, and never
starts services, installs dependencies, connects to DB/providers or deletes files.
It is an explicit artifact-writing command; the **checker** is read-only.

```sh
mkdir .release
node scripts/package-release.cjs backend .release/backend candidate-build
node scripts/package-release.cjs web .release/web
node scripts/package-release.cjs pronunciation .release/pronunciation candidate-build
```

Use a new destination for every assembly. Existing destinations are never cleaned
or overwritten. Backend package metadata omits dev dependencies/Jest/build scripts;
the lock preserves exact dependency versions/integrities, including inert dev graph
metadata. Install runtime dependencies **on the target OS/architecture** with
`npm ci --omit=dev`; never copy Windows node_modules to Linux. Sharp/bcrypt/native
optional dependencies must match that platform. Node modules/virtual environments
are installed image layers, not part of the source-artifact allowlist. The Windows
production-only proof also installs locked optional `@img/sharp-wasm32` and its
`@emnapi/runtime` dependency, which npm 10 labels extraneous; these are vendor
fallback packages, not undeclared application dependencies or test tools. Native
Sharp/bcrypt and the complete application module graph loaded with networking
forbidden. Record the target image's dependency inventory; do not force/prune or
upgrade the stack merely to hide npm's optional-package labels.

Read-only checks (require previously built backend/web outputs, backend dev
dependencies and Git file inventory):

```sh
node scripts/check-release-artifacts.cjs
node scripts/check-release-artifacts.cjs backend .release/backend
node scripts/check-release-artifacts.cjs web .release/web
node scripts/check-release-artifacts.cjs pronunciation .release/pronunciation
node scripts/check-release-contract.cjs
```

The first command is the root release verification command. It validates planned
artifacts without creating them. Optional directory arguments validate an actual
assembled package, rejecting extra files and symlinks. Checks report only safe
metadata, file counts, a deterministic content digest and credential categories/
paths; suspected credential values are never printed. This is a focused category
scanner, not proof that an arbitrary secret can never exist in reviewed source.
No environment files are loaded and no network, signing or deployment occurs.

## Source maps and public hosting

Backend production source maps: **DISABLED** by `tsconfig.build.json`. Web public
source maps: **DISABLED** explicitly by Vite. Both artifact checks reject external
maps and inline/sourceMappingURL references. Backend error redaction/classified
events and JS file/line diagnostics remain intact. Vendor dependency files remain private installed layers,
not public web outputs or part of the application source-artifact allowlist.
Diagnose with the matching
reviewed source/build identity privately; no public debug/source-map server is
introduced. Development TypeScript settings remain independent.

Web API configuration must be explicit HTTPS with no credentials/query/fragment.
Public-release validation rejects IP/private/local endpoints even when a deliberate
self-hosted build override exists. React Router's bare `http://localhost` URL
constructor fallback is inert library plumbing, not a configured API destination;
application loopback URLs with development ports are rejected. No model/provider
service endpoint or token belongs in browser configuration.

Host SPA routes with index.html fallback, while serving missing static assets and
metadata as real 404s (do not rewrite them to HTML). Revalidate index.html and serve
`release.json` no-store/revalidated with its matching bundle. Hashed assets may be
immutable/cacheable. `/release-manifest.json` is intentionally public metadata,
including the already-public API endpoint; it contains no private config. Deploy
index, assets and both manifests coherently. TLS/security headers remain operator
responsibilities.

The approximately 516 kB main JS chunk is **ACCEPTABLE_FOR_CURRENT_RELEASE**, with
**QUALITY_P2_FOLLOWUP** for route/bundle analysis. It contains React/React DOM,
router, icons and application pages. Keep the actual build's raw/gzip sizes in the
release record. No speculative imports/splitting or warning-threshold increase was
introduced to silence the existing 500 kB advisory.

## Supported toolchains

| Tool | Policy |
| --- | --- |
| Node | Node 22 line, minimum 22.14.0; `.node-version` and CI select validated 22.14.0 |
| npm | npm 10 line, minimum 10.9.0; packageManager/CI select 10.9.0 |
| Flutter | Release/test baseline 3.41.7 stable; CI selects it |
| Dart | Flutter's Dart 3.11.5; manifest minimum 3.11.0 follows the checked-in lock |
| Python | Tested 3.12 runtime; `.python-version`/CI select 3.12.4; other versions are not certified |

Both Node components declare identical engines; no dependency versions were
upgraded. Flutter's lock requires Dart >=3.11.0 and Flutter >=3.38.4; pubspec now
declares those existing requirements. This does not certify every SDK allowed by
the resolver constraints: use the selected release/test baseline. Python installs
the complete transitive pins and wheel hashes, using the pinned isolated installer;
CTranslate2/PyAV/faster-whisper native compatibility
must also be checked on the target CPU/GPU image. PyAV wheels carry FFmpeg libraries;
source builds/CUDA require operator-provisioned native libraries. CI uses CPU/stub
model tests and never downloads Whisper weights.

## App version, build ID and protocol

Current packaging versions remain: backend `0.0.1`, web `0.0.0`, Flutter `1.0.0+1`;
pronunciation application version is **UNASSIGNED** (`appVersion: null`). Release
owners assign meaningful independent service/app versions before publication; no
commercial version has been invented. Flutter uses store-facing semantic version
plus increasing integer build number; services/web use their independent release
version plus artifact build ID. A service version can be introduced later through
reviewed package metadata rather than a second handwritten version constant.

Build IDs are bounded public 1-96-character identifiers, independent of app version
and protocol. Local fallback is `development`; CI injects QUALITY_BUILD_ID from
run/attempt. Web builds receive VITE_BUILD_ID, Flutter receives
`--dart-define=BUILD_ID=...`, and backend runtime receives RELEASE_BUILD_ID matching
the packaged manifest. The assembler's optional public ID labels backend/service
artifacts; it cannot relabel an already-built web bundle. Do not put secrets or
arbitrary shell output in an ID. Pronunciation's manifest is artifact metadata,
not a new public runtime endpoint. Protocol revision remains independently owned
by the existing backend/web/Flutter contract, checked without package-version
derivation. Pronunciation has no end-client mutation protocol (`null`).

Android applicationId/namespace are `com.example.lingua_ai`; iOS bundle ID is
`com.example.linguaAi` (test bundles append `.RunnerTests`). These are
**PLACEHOLDER_RELEASE_BLOCKER** for public/store publication, honestly reported by
the checker. Display names are Android `lingua_ai`, iOS `Lingua Ai`; owners must
approve final names/IDs, domains and release naming. No identifiers are renamed.

With pinned Flutter 3.41.7, Android inherits minSdk 24, compileSdk/targetSdk 36 and
NDK 28.2.13676358; project AGP 8.11.1/Kotlin 2.2.20 use Java 17. iOS project target
is 13.0; validate plugins/platform tooling on macOS before store packaging. Main
Android INTERNET/RECORD_AUDIO permissions and iOS microphone explanation remain.
Legacy Android storage permissions remain an operator/platform review item; no
new flavor or broad permission refactor is part of this phase.

## Manual tools

| Tool | Classification and invocation boundary |
| --- | --- |
| Validated start-production/production-entry | RUNTIME_REQUIRED; validates injected config, then boots compiled main |
| validate-production | RUNTIME_REQUIRED local environment/entry shape check; no DB/network |
| deployment-preflight | OPERATOR_TOOL; read-only from the release checkout with runbooks, not the minimal runtime package |
| progress-audit / progress-audit-cli | OPERATOR_TOOL; build checkout first, read-only default, explicit bounded --apply/rollback authorization; excluded from deploy package |
| timeline-control / timeline-control-cli | OPERATOR_TOOL; explicit local inspect/init/close/install/open with target, event, CAS and production confirmations; excluded from runtime artifacts; never startup/preflight/CI infrastructure mutation |
| restore-consistency | OPERATOR_TOOL / read-only drill library; caller-supplied connection and externally retained coordinated manifest, no CLI/repair/reopen/startup hook; excluded from runtime artifacts |
| update-english-db | DEVELOPMENT_ONLY destructive fixture replacement; explicit --replace-local-english-lessons, NODE_ENV=development and loopback lingua_dev/lingua_test URI with directConnection=true, checked before Nest/env loading; never production |
| generate-lessons.js | DEVELOPMENT_ONLY source generator; rewrites lesson source only when manually invoked; not a startup/build hook or deploy file |

Never invoke inspection/repair/replacement automatically on startup. Keep operator
tooling in a separately reviewed checkout; see the existing tooling README for
bounded audit/apply semantics. This phase performs no DB replacement or repair.

## Release validation checklist

Run from a clean checkout with locked dependencies and synthetic config for local
validation. `node scripts/quality-check.cjs` runs the complete tests/builds/static,
production-shape/preflight and new artifact checks without paid/model dependencies.
CI reuses each component's existing build and adds lightweight artifact checks;
release/hygiene runs metadata/toolchain/docs/tool tests. No new costly test job.

### Backend

- [ ] `npm ci`; `npm run build`; `npm test`; `npm run test:e2e` from backend.
- [ ] With injected safe production configuration: `npm run validate:prod` and
  `npm run preflight:deploy` (checkout only). Root quality supplies synthetic values
  without contacting its deliberately invalid Mongo hostname.
- [ ] Assemble/check backend runtime package; target-platform `npm ci --omit=dev`.
- [ ] Inject runtime config, including matching RELEASE_BUILD_ID and explicit
  CLIENT_PROTOCOL_POLICY; `npm run start:prod`. Start is operator action, not an
  offline artifact check. Prove real readiness separately before routing traffic.

### Web

- [ ] `npm ci`; `npm test`; build with explicit safe values, for example POSIX:
  `VITE_API_URL=https://api.example.invalid VITE_BUILD_ID=candidate-build npm run build`.
  PowerShell: set `$env:VITE_API_URL` / `$env:VITE_BUILD_ID`, then `npm.cmd run build`.
- [ ] Root artifact check/assembly; record real chunk sizes; deploy coherent SPA
  assets and manifests under the approved public endpoint/hosting policy.

### Flutter

- [ ] `flutter pub get --enforce-lockfile`; `flutter test`; `flutter analyze`.
- [ ] `flutter test test/release_config_test.dart test/protocol_compatibility_test.dart`.
  These unsigned checks require no keystore, store package or production endpoint.
- [ ] Approve/assign final platform IDs, display names, app version/build, API_URL
  and public BUILD_ID. Preserve original protocol metadata in pending work.
- [ ] Operator only: supply ignored `android/key.properties` with storeFile,
  storePassword, keyAlias and keyPassword; keystore must remain outside Git. Release
  Gradle tasks reject missing inputs and never use debug signing.
- [ ] On provisioned platform tooling: `flutter build appbundle --release
  --dart-define=API_URL=https://api.example.invalid --dart-define=BUILD_ID=candidate-build`
  (replace validation placeholders for the actual approved release). iOS needs
  macOS/Xcode, approved bundle ID, team, distribution certificate and provisioning
  profile; `flutter build ipa --release` with the same explicit defines is an
  operator action. No signed AAB/IPA is claimed by this phase's validation.

### Pronunciation

- [ ] Fresh Python 3.12.4 venv; bootstrap
  `python -m pip install --require-hashes --only-binary=:all: --no-deps -r requirements-installer.txt`,
  then `python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.txt`
  (production uses `requirements.txt`); `python -B -m pip check`.
- [ ] `python -B -m unittest -v test_service`; `python -B ../scripts/check-python.py`.
  Tests stub Whisper; no model download/load is needed.
- [ ] With externally injected production config, `python -B config.py --production`
  validates without inference/model load. Assemble/check source artifact.
- [ ] Provision target-platform dependencies and immutable model/cache mount
  with nonempty `model.bin`, `config.json`, `tokenizer.json`; a missing tokenizer
  or cache must fail readiness without fallback egress. Verify model digests;
  the Python lock covers package wheels, not model weights.
  Operator starts `python -B main.py`: one worker, no reload, private
  service token/network, 35-second default inference deadline and documented drain.

## Promotion, rollback and remaining operator requirements

Keep artifact digest/build ID/version, protocol cohort, config and state evidence
separate in the deployment record. Credential rotation/revocation remains
**UNVERIFIED** and production traffic remains unauthorized. Assign placeholder
mobile identities and signing, approved DNS/TLS/endpoints, private pronunciation
network/model artifacts, shared uploads, actual transaction/index readiness and
coordinated restore evidence before real deployment/publication.

Rollback requires compatible protocol generation and client cohort validation,
original queued/durable-intent protocols and IDs, current receipts/epochs/revisions/
clear barriers, native storage generations and old-tab handling. Pre-7A tabs still
need operator-directed reload/closure; current bundles support update notices.
Never clear owner queues/journals or promote old protocols to make rollback pass.
Prefer forward-fix when these contracts differ. See [RELEASE_COMPATIBILITY.md](RELEASE_COMPATIBILITY.md),
[CLIENT_RECOVERY.md](CLIENT_RECOVERY.md) and [PRODUCTION_RUNBOOKS.md](PRODUCTION_RUNBOOKS.md).
This is not restore-generation fencing or a new deployment/container platform.
