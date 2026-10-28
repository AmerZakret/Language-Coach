# Phase 11A final dependency and supply-chain audit

Review snapshot: 2026-10-28. Branch `phase-11-security-and-release-readiness`.
This audit record is uncommitted and unpushed; no application source changed.
Phase 11B has not started and main has not been pushed or merged.

## Committed remediation chain

| Stage | Commit | Result |
|---|---|---|
| R1 backend runtime/upload | `d8877dc62c9459a8f14e823083871e86eef0f053` | Reachable Multer parser findings removed; proxy-addr 2.0.8; Nest 11 coherent; dev Handlebars patched |
| R2 Python/CI | `11579bec743968a5e960adb0fe7dfa7e5206bd91` | Patched Python TLS/multipart dependencies, exact hashed runtime and installer locks, immutable CI action pins |
| R3 web/remaining dependencies | `ea6021aa02bdf080b3164a744fa51b7c188ccef9` | Web npm audit zero; body-parser, qs, Mongoose and compatible transitives patched |

The three commits are linear. [Exact R3 hosted CI](https://github.com/AmerZakret/Language-Coach/actions/runs/40718140882) passed backend, web, Flutter, pronunciation and release-hygiene.

## Current registry findings and reachability

| Component | Affected packages: critical/high/moderate/low | Distinct advisories | Application-reachable high/critical |
|---|---|---:|---|
| Backend npm | 0 / 2 / 0 / 8 | 2: 1 high, 1 low | None demonstrated |
| Web npm | 0 / 0 / 0 / 0 | 0 | None |
| Python OSV | 0 / 1 / 1 / 3 | 5 after alias deduplication; 2 affected packages | None demonstrated |

Backend's two high package entries are one underlying [Multer async-fileFilter advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) on `multer@2.4.0` and its Nest parent. Community and pronunciation upload interceptors configure no `fileFilter`, asynchronous callback, or dynamic filter. Nest 11.2.6 pins Multer 2.4.0; avoid a Nest 12 migration solely for this unused path. The eight low package entries propagate one [deepmerge finding](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) through Jest/Nest CLI development tooling; the production-only backend install excludes that tree. Do not accept npm audit's old Jest/Nest downgrade suggestions.

Python `filelock@3.29.0` retains [GHSA-v4x8-3wr5-3wq8](https://github.com/advisories/GHSA-v4x8-3wr5-3wq8) (high, SQLite ReadWriteLock), GHSA-9vhv-jxww-xfm5 (low, SQLite ReadWriteLock Windows side files), and GHSA-567q-5qvw-pf92 (low, SoftFileLock local Windows oplock). The service does not use SQLite reader/writer locks; production uses a provisioned immutable model/cache rather than concurrent downloads. `setuptools@82.0.1` retains GHSA-h35f-9h28-mq5c (moderate, macOS sdist MANIFEST) and GHSA-xmj3-9gf7-h52w (low, legacy Windows wheel installation). Production installs reviewed hashed wheels only. These local/build APIs are not demonstrated request exposures. Reassess filelock 4.x and setuptools in a separately reviewed compatible update.

## Supply-chain and artifact checks

- Both committed npm lockfiles resolve only `registry.npmjs.org` package URLs, with integrity entries; no git, URL, local-file direct dependencies, wildcard direct pins or overrides. `npm ci` is enforced. Local `npm ls --all` reports only platform-optional extraneous WASM packages; no vulnerable duplicate runtime copy was found.
- Python locks exactly 40 runtime packages plus `pip==26.2.2`, requires published wheel SHA-256 hashes and binary-only installation, and regenerated identically in an isolated copy. Fresh Windows installs, dependency checks and tests passed; exact R3 hosted Ubuntu CI verified Linux lock installation. No global pip was modified. Runtime and pip-vendored certifi are both 2026.10.19.
- Dart's committed lock contains 112 hashed pub.dev hosted packages and 4 SDK entries. Flutter lock enforcement, 480 tests and analysis passed in the established workspace and exact R3 hosted CI. A separate fresh Windows copy could not create plugin symlinks because Developer Mode is disabled; this did not change the lock or source.
- Every external action in the release workflow is pinned to an immutable commit with a semantic version comment. Workflow permissions remain `contents: read`. Tracked HEAD secret-pattern scan found no provider/registry/GitHub/AWS tokens or private keys. Tracked Mongo URI matches are credential-free test fixtures; only `.env.example` files are tracked. Historical credential rotation and revocation are not verified.
- Backend source artifact validated at 104 files. A disposable `npm ci --omit=dev` installed patched Multer 2.4.0, proxy-addr 2.0.8, body-parser 2.4.0, qs 6.17.0 and Mongoose 9.7.2, without Jest, Nest CLI, mongodb-memory-server, ts-jest or Handlebars. Expected runtime bcrypt install hook remains; Mongo test server, unrs-resolver and optional fsevents hooks are development/platform only.
- Web artifact validated at 16 static files, without Node modules, Vite server, tests or source maps. Pronunciation artifact validated at 6 files; its runtime and installer locks match the committed source. A production-only hashed Python install passed with 41 total packages and no dependency conflicts; models, audio, caches and environment files are excluded.

## Verification and limits

Full local quality gate passed on committed HEAD: backend 751, backend e2e 4, web 420, Flutter 480, pronunciation 37 and root tooling 14 tests. Backend/web builds, Flutter analysis, synthetic `validate:prod` and `preflight:deploy`, release contracts, artifact checks and `git diff --check` passed. Fresh exact-HEAD backend and web copies passed `npm ci`, builds and tests; fresh Python installation and tests passed. Production model/tokenizer fallback remains blocked without provisioned local artifacts.

One local full-gate attempt timed out in the disposable Mongo restore contention drill. The isolated drill then passed 95/95, the complete gate passed on one retry, fresh backend tests passed, and exact R3 hosted CI passed. A 40 ms Python parser-timeout test also failed under parallel fresh installs, then passed alone and in the full 37-test Python retry. These are timing-sensitive local test observations, not reproduced application failures. No production database, provider or model download was used.

## Decision

| Question | Decision |
|---|---|
| Dependency blocker for local development, staging or production | NO |
| Application-reachable high/critical dependency finding | NO |
| Supply-chain or Python reproducibility blocker | NO |
| Phase 11A dependency security complete | YES |
| Safe for a reviewed local Phase 11A merge | YES; no merge performed |
| Ready to start Phase 11B now | NO; local integration decision remains |

Production traffic and public/store release remain unauthorized. Historical Mongo credential rotation and old credential revocation are unverified. Real infrastructure, backups/restores, capacity, shared uploads, ingress/global rate limiting, model provenance, mobile signing and public IDs remain deployment, operator and release-owner requirements. No Phase 11B work is included here.
