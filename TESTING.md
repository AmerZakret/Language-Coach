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
browser-context/Web Locks simulations, not a real browser runner.

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
