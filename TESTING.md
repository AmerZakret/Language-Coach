# Local test baseline

Run commands from the component directory, using its local dependencies. On
Windows PowerShell, `npm.cmd` avoids the system's npm.ps1 execution-policy issue.
Install Node dependencies with `npm ci`, Flutter dependencies with `flutter pub get`,
and Python test dependencies in an isolated Python 3.12 virtual environment with
`python -m pip install -r requirements-dev.txt`.

| Component | Complete test command | Additional check |
|---|---|---|
| Backend | `npm test` | `npm run test:e2e` |
| Web | `npm test` | Build with explicit safe `VITE_API_URL` |
| Flutter | `flutter test` | `flutter analyze` |
| Pronunciation | `python -B -m unittest -v test_service` | `python -B -m pip check` |

Backend `npm test` first rebuilds production artifacts, then runs the entire Jest
discovery serially. Most tests import source; `config/runtime-config.spec.ts`,
`operations/readiness.spec.ts` and `operations/deployment-runbooks.spec.ts` also
exercise the compiled production launcher/preflight. They deliberately require a
fresh build rather than whatever dist a previous developer left behind. Do not run
a separate build concurrently with these tests: Nest replaces dist while building.
Watch/coverage/debug Jest variants are optional developer tools, not full quality
substitutes; build before using them directly.

Jest integration tests start disposable Mongo replica sets; readiness also tests a
standalone server. Initial mongodb-memory-server use may download a mongod binary;
pre-provision/cache it for offline execution. Providers are mocked. The separate
e2e suite creates its replica set and temporary upload root before importing the
application, replaces inherited application configuration, disables dotenv, blocks
non-fixture Mongo connections, disables both provider features and forbids fetch.
Initialization failure has no developer/production fallback. No local .env, Atlas,
paid inference, production token or signing key is required.

The web and Flutter reset-route contract tests start a disposable loopback Nest
fixture and therefore also need Node and the backend dev dependencies installed.
They use no database.
Native sync-store tests use temporary directories; ordinary preference fixtures
retain their explicit test adapter. Web tests use isolated in-memory storage and
browser-context/Web Locks simulations, plus real React DOM rendering in jsdom
for pronunciation hook order, connectivity transitions and retained practice state.

Python tests use stub model loading/inference, synthetic audio and real bounded
PyAV decoding. They never download/load Whisper. The inference-timeout fixture
arms a real asyncio cancellation deadline only after the worker signals entry,
then explicitly releases/awaits that worker. Five-second waits are stuck-fixture
guards, not the ordering mechanism. Model-startup fixtures await lifecycle events.

Tests must remove their generated uploads/audio/database/store fixtures and leave
`git status --short -uall` unchanged apart from intentional source edits. Build and
tool caches are ignored. Do not expire receipts, clear owner queues or use real
accounts as test cleanup. Production configuration checks use injected synthetic
configuration and never verify credential rotation or authorize production traffic.

## Phase 9A scaffold decisions

Each removed suite contained only `should be defined`, instantiated a class in an
otherwise empty Nest testing module, and omitted its required providers. No
behavioral assertion is removed. The following existing tests construct the real
providers and exercise stronger behavior; no skip or discovery exclusion replaces
these deletions.

| Removed suite under backend src | Missing fixture providers | Existing stronger coverage |
|---|---|---|
| auth/auth.controller.spec.ts | AuthService | auth/guest-isolation.spec.ts: register/login/guest HTTP flows |
| auth/auth.service.spec.ts | UsersService, JwtService | auth/guest-isolation.spec.ts: distinct guests, reserved login, registration and JWT ownership |
| users/users.controller.spec.ts | UsersService | auth/domain-identity.spec.ts: safe auth/profile identity; auth/payload-mutation.spec.ts: profile routes |
| users/users.service.spec.ts | UserModel | auth/payload-mutation.spec.ts: profile persistence/omitted fields; auth/guest-isolation.spec.ts: user creation/login |
| progress/progress.controller.spec.ts | ProgressService | auth/domain-identity.spec.ts: JWT-owned read/complete/reset and validation |
| progress/progress.service.spec.ts | Connection and Progress/User/Lesson/ProgressReset models | progress/progress-consistency.spec.ts: transactional completion/reset, epochs and XP |
| ai-coach/ai-coach.controller.spec.ts | AiCoachService | auth/domain-identity.spec.ts: authenticated history/clear/writing; common/mutation-hardening.spec.ts: send/clear routes |
| ai-coach/ai-coach.service.spec.ts | ConfigService, ChatMessage/User/ChatBarrier models, MutationReceipts | common/mutation-hardening.spec.ts and security/provider-replay.spec.ts: atomic pairs, replay, clear barriers and provider failure |

## Web release source and dependencies

`src/main.tsx` is the Vite entry. Its application import graph uses axios,
lucide-react, react, react-dom and react-router-dom as direct runtime packages.
The manifest now matches the existing lockfile's working Lucide 1.14 line; this
does not upgrade the installed icon library. CSS also directly imports
`tw-animate-css`; it is declared as a build dependency at the working installed
1.4.0 version. Build/test packages remain dev-only.

`src/new_components` (59 files) is unreferenced prototype/reference code, category
B, not part of the production entry graph. Its existing TypeScript exclusion is
unchanged. Of the 52 copied dependency entries absent from the old lock root, 51
are prototype-only/unused and removed; the active CSS dependency is retained in
devDependencies. The standalone `Design/`
reference bundle retains its own manifest. No prototype source is moved, deleted,
adopted into runtime or newly excluded by this phase. Prototype cleanup is separate.

## Repository quality gate (Phase 9B)

After `npm ci` in backend and web, `flutter pub get` in `lingua_ai`, and Python
requirements installed in an isolated environment, run from the repository root:

```sh
node scripts/quality-check.cjs
```

The deterministic order is backend (fresh build, full tests, hermetic e2e,
read-only lint), web (dependency tree, full tests including real React rendering,
explicit HTTPS placeholder production build, read-only lint), Flutter (locked
pub get, full tests, analyze), pronunciation (full stub-model tests,
syntax/import/config/direct requirements, pip check), release configuration,
and hygiene/tooling tests. `node scripts/quality-check.cjs <component>` also
accepts `backend`, `web`, `flutter`, `pronunciation`, `release`, or `hygiene`.
Set `QUALITY_PYTHON` to the Python executable in your isolated test environment;
on Windows the existing service `venv/Scripts/python.exe` is detected, otherwise
`python3` (Windows: `python`) is used. The script does not install Node/Python
packages. The locked pub install may download packages; first Mongo use may
download its disposable server binary. No Whisper model is downloaded or loaded.

`.github/workflows/quality.yml` runs five independent Ubuntu 24.04 jobs with Node
22.14.0 with explicitly selected npm 10.9.0, Flutter 3.41.7 / Dart 3.11.5, and Python 3.12.4.
Node installs use `npm ci`; Flutter enforces its lock; Python installs both pinned
requirements files in a fresh venv. Web/Flutter contract tests also install
backend dev dependencies. Only npm/pip download caches keyed by manifests and
selected toolchains are used; no env, uploads, audio, model or credential caches.

All tests use disposable Mongo, temporary storage and mocked providers. The
runner removes inherited application credentials/config from child environments.
Release validation uses newly generated ephemeral JWT material, reserved `.invalid`
hostnames and disabled provider features; it makes no infrastructure connections.
Neither CI nor these commands prove rotation/revocation, live infrastructure,
restore success, browser engine/device behavior or signing/release packaging.
No production traffic is authorized by a green workflow.

Each component snapshots source/unignored files and the index before execution,
then fails if checks mutate them or leave unignored artifacts. Existing local
source edits are permitted but must remain byte-for-byte unchanged. CI additionally
requires a clean tracked tree and no untracked files after installation/checks.
The path hygiene gate rejects caches/build output, backend runtime uploads,
model-cache, non-example `.env` variants and signing/private-key artifacts.
Legitimate source audio/assets and explicitly named env examples remain allowed.
It is a precise path gate, not a claim to identify every live secret.

### Read-only lint backlog policy

`node scripts/lint-ratchet.cjs backend` / `web` runs the unchanged component ESLint
rules with `fix: false`. It prints the full current production-source/test backlog
and fails every new diagnostic against the reviewed 9A commit
`cd0d28bf108186466ef3fede14de6778cf44159d`. CI fetches history for this comparison;
a missing baseline fails closed. No JSON suppression inventory or count threshold
is maintained. Historical source is extracted into an owned temporary tree and
linted with the same current rules in a separate process. This keeps TypeScript
project symbols and source positions from being mixed across revisions. Tar and
filesystem links are required (available on the selected Ubuntu runner and tested
Windows environment); the temporary tree is removed without touching source. Diagnostics match by rule, severity, message and source line,
with occurrence counts: moving unchanged debt is tolerated, adding another
occurrence or changing the offending line is not. Changes can reduce the backlog;
updating the baseline requires a separately reviewed change. Core undefined,
unreachable, async-promise-executor and hook-order defects are forbidden even
if historical. New root tooling and the real DOM fixture also pass core ESLint checks.
No lint command in the quality gate uses auto-fix. The backend's
legacy `npm run lint` developer command still includes `--fix`; do not use it as
a read-only gate. Repository-wide cleanup/strictness migration remains deferred.
Prototype `src/new_components` is PROTOTYPE_REFERENCE, excluded from release
checking as documented above; each web gate verifies the actual TypeScript
import graph from `src/main.tsx` still reaches zero prototype modules. Prototypes
have additional historical lint debt and are not claimed clean.

### Runtime regression contracts

Pronunciation calls every hook on every render; offline UI is selected afterward.
Offline mounting/connectivity changes start no source fetch or assessment. A source
response invalidated by connectivity/language/owner effect cleanup is ignored.
The real React tests exercise online -> offline -> online and initial offline
mounting; they complement the existing VM suite rather than replace it.

Web study reviews persist into the existing owner-locked queue before their first
HTTP attempt, including online reviews. One stored action ID is the idempotency
key through ambiguous acknowledgement, reconnect and page disposal. Storage
failure prevents study advancement. After durable persistence, optimistic SRS
state may advance; transient/auth failures remain pending under the original owner.
Corrupt queue records are preserved and surfaced; they block review submission.
Terminal validation/conflict actions move to existing durable quarantine, do not
retry automatically, and display a persistent notice with a server-refresh recovery
action. A refresh reconciles card state; intentionally reviewing again is a new
logical review, not a retry of the quarantined action. Active study snapshots are
not refreshed by their own queue drain; same-render duplicate submissions are
blocked. Server receipt/history exactly-once behavior remains covered by the full
backend tests; web tests verify transport replay with one operation ID and a
receipt-aware fake server. That Phase 9B change did not add Community/AI intent
persistence or protocol gating; Phases 9C/9D below now provide those contracts.

## Phase 9C compatibility and identity checks

See [Release identity and client compatibility](RELEASE_COMPATIBILITY.md) for the
protocol route inventory, explicit production policies and staged rollout.
`node scripts/check-release-contract.cjs` executes the backend/web source constants;
Flutter's `protocol_compatibility_test.dart` compares its compiled constant against
that same machine-readable output. Backend HTTP tests inventory every real
controller route, exercise enforcement/errors/CORS and all four flashcard key gates.
Existing database suites remain the durable receipt/replay correctness gate.
Web tests use real client/queue contexts for rejection and cross-tab preservation,
real React DOM for the reload notice, and execute the Vite manifest plugin.
Flutter tests use real temporary two-slot storage across compatibility rejection
and reopening, alongside transport/header/key tests. No queue generation is upgraded
by changing the running application's protocol constant.

CI sets public `QUALITY_BUILD_ID=ci-<run>-<attempt>`; the root command passes it to
web build configuration, Flutter test compilation, and synthetic backend release
validation. Local quality runs use `quality-check`. Ordinary component builds use
explicit `development` unless a public artifact ID is supplied. The root command
validates this identifier before passing any shell argument. No source rewrite,
package version change or private Git history is needed for build identification.
New protocol metadata is optional for historical queue records: they remain
headerless on replay and must be drained/reconciled before enforcement rollout.
Compatibility failures pause execution rather than entering permanent quarantine.
# Phase 9D client recovery regressions

The normal full component commands include all recovery tests. For focused work:

```sh
cd lingua_ai_web
node --test test/intent-recovery.test.cjs test/mutation-replay.test.cjs test/session-response.test.cjs
```

```sh
cd lingua_ai
flutter test test/online_intent_recovery_test.dart test/mutation_replay_test.dart test/ai_history_session_test.dart test/community_cache_test.dart test/protocol_compatibility_test.dart
```

These tests exercise actual owner-scoped journals, Web Locks with independent
browser contexts, native temporary two-slot stores, lost acknowledgements,
restart/disposal, corruption and verified-backup evidence, bounded retry clocks,
capacity, account/language changes, original protocol retention, and local
acknowledgement failures. Provider/receipt behavior is mocked at client transport
boundaries; the full backend `common/mutation-hardening.spec.ts` suite separately
proves real transactional Community/AI receipt replay and clear-barrier safety
using disposable Mongo. No Atlas, paid provider, real service credential, or
Whisper model is required. Language/writing boundary unit fixtures explicitly
mock recovery; the recovery suites execute the actual implementation.

See [CLIENT_RECOVERY.md](CLIENT_RECOVERY.md) for the operation classification,
capacity/no-TTL contract, failure semantics and conservative backup handling.

## Release packaging

See [Release packaging and checklist](RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.


## Phase 9E artifact and packaging gates

`node --test scripts/release-artifacts.test.cjs` exercises allowlists, map policy,
credential categories, real Vite metadata generation, guarded destructive tooling,
non-overwriting assembly, mobile identity/signing and toolchain/docs consistency.
The root quality command includes these tests and component artifact checks.
After builds, `node scripts/check-release-artifacts.cjs` is the read-only root
release check. `node scripts/package-release.cjs COMPONENT NEW_DIRECTORY [BUILD_ID]`
is a separate explicit writer for ignored/local deployment artifacts, not a deploy
or sign command. See RELEASE_PACKAGING.md for clean installation and operator
boundaries. Model caches and developer environments are never packaged.


## Phase 10B server fencing

Run backend `npm test` and `npm run test:e2e`, plus `node scripts/quality-check.cjs`
for the complete repository baseline. `src/operations/mutation-timeline.spec.ts`
uses only mongodb-memory-server replica sets, isolated temporary upload roots and
mocked providers. It covers v1/v2 rollout, 400/426/428/409/503, CORS/auth/ownership,
receipt provenance/uniqueness, lost-receipt restores, account/profile writes,
in-flight close, image compensation and public CLOSED-state discovery.

The mandatory destructive AI-clear test commits A's clear, restores pre-clear
messages while removing its receipt/barrier, installs B, sends a B message and
replays the original A clear key. It verifies 409 before receipt/barrier/delete
work, no provider call, and preservation of restored plus later messages.

Isolated domain fixtures explicitly call test/timeline-fixture.ts with synthetic
configuration and disposable loopback Mongo; no runtime or NODE_ENV bootstrap is
added. Non-database unit suites inject a named UnitTimelineModule test double.
Catalog fixtures seed reviewed lesson data explicitly; application startup no
longer inserts lessons. Runtime route metadata plus the public writer inventory
fail tests when new public mutations lack classification.

Release checks assert server protocol 2, web/Flutter protocol 1, legacy minimum 1
and clientsTimelineAware=false for this stage. Only client tests recognize that
staging state; client runtime/queue/cache behavior is unchanged. Four/six concurrent
transactions exercise real shared-record contention and bounded retries, not load
characterization. No production Mongo/provider/network action is part of testing.


## Phase 10C web timeline checks

Run web npm test (including test/timeline.test.cjs) and an explicit production build
with VITE_API_URL=https://api.example.invalid. Run node scripts/quality-check.cjs
for the backend build/unit/e2e, web build/lint/artifacts, Flutter test/analyze,
pronunciation tests and safe synthetic validate:prod/preflight gates. No production
connection or provider call is involved.

Timeline tests execute the real discovery/state/HTTP/queue/intent boundaries with
isolated browser contexts, shared storage and Web Locks. They cover canonical and
missing/malformed discovery, cached offline creation, unknown offline rejection,
first-confirmation legacy preservation, stored protocol-2 headers, A-to-B progress
same-epoch/reset and flashcard replay blocking, Community/AI intent retention,
AI clear local discard and new B identity, stale responses, cache rejection,
cross-tab advertisement and lock rereads, and 409/428/426/503/401 classification.
The mutation inventory compares public durable routes to central behavior. Existing
Phase 7/9 durability suites run with explicitly confirmed synthetic timeline fixtures;
legacy migration and unknown discovery tests never receive that fixture shortcut.

Release checks assert server/web protocol 2, Flutter protocol 1 and staged
enforcement. They do not assert full production restore safety before 10D/10E.

## Phase 10D Flutter timeline checks

Run `node scripts/quality-check.cjs flutter` for locked dependency resolution, the
complete Flutter suite and analysis. Native restore scenarios live in
`lingua_ai/test/data_timeline_test.dart`; AI widget scenarios include timeline
changes and stale clear confirmations. Release checks now assert backend, web
and Flutter revision 2, with `ALLOW_LEGACY` minimum 1 and no global enforcement
change. Earlier phase assertions describe historical checkpoints.

See [the Flutter implementation inventory](PHASE_10D_FLUTTER_TIMELINE_STORAGE.md).
