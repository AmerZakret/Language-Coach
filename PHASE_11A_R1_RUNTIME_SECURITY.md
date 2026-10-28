# Phase 11A-R1 runtime security remediation

Review snapshot: 2026-10-28. Work is uncommitted and unpushed on
`phase-11-security-and-release-readiness`, based on
`67b1e54e5127afc0fd65bcea6b040075aea7acc3`. Phase 11B is not started.

## Selected changes

| Package | Installed before | Installed after | Purpose |
|---|---|---|---|
| @nestjs/common, @nestjs/core, @nestjs/platform-express | 11.1.19 | 11.2.6 | Coherent Nest 11 runtime update |
| @nestjs/testing | 11.1.19 | 11.2.6 | Match runtime parents |
| multer | 2.1.1 | 2.4.0 | One deduplicated direct/Nest runtime instance |
| proxy-addr | 2.0.7 | 2.0.8 | Normal Express transitive resolution |
| ts-jest | 29.4.9 | 29.4.15 | Compatible Jest 30 development patch |
| handlebars | 4.7.9 | 4.7.10 | Development-only transitive patch |

Registry metadata identifies Nest 11.2.6 as the earliest available Nest 11 release
pinning Multer 2.4.0. These coupled direct versions are exact pins. Express stays
at 5.2.1; its existing proxy-addr range accepts 2.0.8. There are no overrides,
major migrations, audit-fix commands, or Jest downgrades. Automated audit
suggestions to old Nest/Jest stacks are rejected.

Only eight package versions changed. Nest/Multer remove four obsolete packages:
@nuxt/opencollective, consola, concat-stream and typedarray. Several former shared
runtime dependencies consequently become dev-only. Unrelated package versions,
Flutter dependencies, web dependencies and Python dependencies are unchanged.

## Upload and proxy behavior

All installed runtime Multer copies are patched against
[GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j),
[GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), and
[GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4).
Both APIs accept flat metadata fields. They now explicitly set fieldNameSize=100,
fieldNestingDepth=0 and fieldArrayIndexLimit=0, opting into the patched parser's
bounds before append-field allocation. Existing file/field/part/byte limits remain.

Community POST/PUT and pronunciation POST use memoryStorage with no configured
fileFilter. [GHSA-q7qp-rjg7-q26m](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m)
remains in Multer 2.4.0 but requires asynchronous fileFilter behavior, which is
absent. Reassess this disposition before introducing that feature; no Nest 12
upgrade or forced Multer resolution is warranted in R1.

The runtime path is @nestjs/platform-express -> express -> proxy-addr 2.0.8.
[GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) is removed.
TRUST_PROXY still defaults to false; configuration validation is unchanged.
HTTP tests cover spoofed forwarding with trust disabled, intended IPv4 CIDRs,
IPv4-mapped peers, the patched IPv6 subnet confusion, malformed/rejected policies,
and IP rate-limit buckets through trusted/untrusted hops.

Small malicious-field fixtures cover depth, numeric array indexes followed by
named keys, and pathological bracket structures. Community create/edit reject
with 400, preserve posts/receipts/files/fenceVersion, perform no permanent image
storage, and remain usable afterward. A stale timeline still rejects with 409
before upload storage. Pronunciation rejects before provider work, requires JWT,
and releases admission permits. Its dedicated service credential and redirect:
'error' behavior remain covered by the production proxy tests.

Existing upload suites retain authentication, byte/pixel/type validation, Sharp
decode/re-encode, derived extensions, UUID filenames, containment/symlink rules,
nosniff, transaction fencing, compensation and protected deletion behavior.

## Verification

`node scripts/quality-check.cjs` passed in full with no source/index mutation:

| Component | Result |
|---|---|
| Backend | 27 suites, 751 tests; build passed |
| Backend e2e | 1 suite, 4 tests |
| Web | 419 tests; production build passed |
| Flutter | 480 tests; analyze: no issues |
| Pronunciation | 31 tests; syntax/import/config and pip check passed |
| Root tooling | 14 tests |
| Release | validate:prod, preflight:deploy, release contract and artifact gates passed |

Backend/web lint ratchets accept existing debt with zero new/critical diagnostics.
The web build retains its existing large-chunk advisory. Synthetic release checks
use .invalid endpoints, ephemeral credentials and disabled providers, with no
production database/provider connections.

Fresh source-only workspace `.release-validation/r1-clean-67b1e54` passed npm ci,
build and all 751 backend tests. Its manifest/lock hashes match the working tree.
The safe repository-local location avoids the known OS-temp upload-fixture issue.

The existing release assembler/validator produced a 104-file backend artifact in
`.release-validation/r1-artifact-backend`. Installing it with npm ci --omit=dev
and recursively inspecting actual packages found exactly Multer 2.4.0 and
proxy-addr 2.0.8, with Nest/direct Multer resolving the same file. Jest, ts-jest,
Handlebars and Nest testing are absent from that production installation.

`npm ls --all` retains the same two pre-existing Sharp optional WASM entries
reported extraneous by npm 10: @img/sharp-wasm32 and @emnapi/runtime. They also
appear after fresh production installation. This is not new lockfile churn or an
old Multer/proxy-addr copy. No dependency was pruned to conceal inventory output.

## Registry totals and remaining exposure

Current npm audit metadata counts affected packages, including propagated parent
findings; it does not count unique underlying advisories:

| Component | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| Backend | 0 | 8 | 3 | 9 | 20 |
| Web, unchanged | 0 | 12 | 1 | 1 | 14 |

Deduplicating advisory URLs instead gives backend 37 (0 critical, 21 high,
11 moderate, 5 low) and web 54 (0 critical, 25 high, 26 moderate, 3 low).
The unchanged approved Python inventory contains 21 reviewed GHSAs after alias
deduplication (2 critical, 4 high, 7 moderate, 8 low); Python was not re-audited or
remediated here. Flutter has no comparable registry audit count in this pass.

No demonstrated application-reachable backend runtime dependency blocker remains
from the R1 targets. Installed runtime packages still flagged by the registry are
Multer (unused async filter), body-parser (inflate:false and valid explicit limits
avoid the reported vulnerable behaviors), qs (simple parsing, no affected
stringify/comma paths), and Mongoose (allowlisted DTOs and server-built writes;
no demonstrated attacker-selected update-path exposure). These dispositions are
feature-specific, not a claim that the installed versions are advisory-free.

| Remaining finding | Exposure / classification | Next action |
|---|---|---|
| Multer async-fileFilter advisory | Unused feature; EXPECTED_LIMITATION | Reassess if filters change; later compatible parent patch |
| body-parser, qs, Mongoose | Conditional runtime features; SECURITY_P2 | Compatible low-risk patches in 11A-R2 |
| Backend @babel/core, baseline-browser-mapping, brace-expansion, browserslist, deepmerge, fast-uri, form-data, js-yaml and propagated Nest/Jest/tooling findings | Dev/build/test graph; SECURITY_P2 | 11A-R2; no attacker-provided tooling input |
| Web axios/follow-redirects/form-data and react-router/react-router-dom | Browser/unused server-feature distinctions retained; SECURITY_P2 | Separate web remediation/disposition |
| Web Vite, PostCSS, nanoid, source-map-js, zod and shared build dependencies | Build/dev or conditional features; SECURITY_P2 | Separate web wave; do not expose development servers |
| Python certifi/AnyIO TLS findings | Retained critical registry findings; SECURITY_P1 | Resolve or document deployment-specific disposition before networked staging/production |
| Python filelock, fsspec, pip, python-multipart, setuptools, Starlette; other AnyIO findings | Conditional local/tooling/runtime paths; SECURITY_P2 | Dedicated Python wave; bounded custom multipart parser retained |
| CI actions use mutable major tags | Supply chain; SECURITY_P2 | SHA pinning in 11A-R2 |
| Python lacks complete transitive lock/hashes | Reproducibility/supply chain; SECURITY_P2 | Dedicated lock/hash work |
| Historical lint debt | QUALITY_P2 | Existing ratchet; no broad cleanup |
| Existing web chunk warning | QUALITY_P3 | Separate performance work |
| Sharp optional WASM inventory labeling | EXPECTED_LIMITATION | Retain explicit classification |

Handlebars has been patched and is not a remaining finding.

## Security decision

DEPENDENCY SECURITY BLOCKER FOR LOCAL DEVELOPMENT: NO

DEPENDENCY SECURITY BLOCKER BEFORE STAGING: YES

DEPENDENCY SECURITY BLOCKER BEFORE PRODUCTION: YES

The demonstrated backend Multer/proxy-addr staging blockers are cleared. The
overall staging/production hold remains for disposition/remediation of the retained
Python critical TLS inventory and reproducible deployment dependencies. R1 does
not authorize or establish an integrated deployment's dependency safety.
SECURITY_BLOCKER: none within R1; retained deployment dependency hold as above.

PUBLIC/STORE RELEASE AUTHORIZED: NO

HISTORICAL MONGO CREDENTIAL ROTATION VERIFIED: NO

OLD CREDENTIAL REVOCATION VERIFIED: NO

PRODUCTION TRAFFIC AUTHORIZED: NO

R1 is ready for review and safe to commit after review. No commit or push was
performed. Next: 11A-R2 remaining low-risk dependency and supply-chain remediation.
