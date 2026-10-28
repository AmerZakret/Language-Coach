# Phase 10E — disposable restore drill and multi-instance validation

## Scope and isolation

Phase 10D commit `97a6872ad5005fc2f3a082116f81e9d666707662` is pushed and its
[exact hosted workflow](https://github.com/AmerZakret/Language-Coach/actions/runs/40571654331)
passed backend, web, Flutter, pronunciation and release-hygiene.
10E remains uncommitted/unpushed. No production traffic/release is authorized.

The backend drill creates one mongodb-memory-server replica-set member with a
unique `restore10e_...` database and two independent Nest/Mongoose application
contexts sharing that database. Connections are asserted to be the owned
loopback fixture. Uploads use an owned `restore-10e-.../community` temporary tree.
All users, operation IDs, JWT material and data are synthetic; provider `fetch`
and flashcard context generation are deterministic fakes. No .env is loaded.
No Atlas, production Mongo/uploads, production credentials or provider APIs are
used. Client tests use their existing isolated HTTP/browser/native-file harnesses,
not a real provider or live deployment.

Synthetic lineage values (public placeholders, not secrets):

- A: `11111111-1111-4111-8111-111111111111`
- B: `22222222-2222-4222-8222-222222222222`
- Unknown C: `33333333-3333-4333-8333-333333333333`

## Snapshot and restore model

S0 captures raw BSON documents for every non-system fixture collection, including
users, lessons, progress/epochs, progress-reset receipts, flashcards/scheduling,
flashcard-operation receipts, Community posts/revisions/reactions, mutation
receipts, AI messages/barriers, timeline control and control-event history.
Snapshot restoration deletes post-S0 fixture documents and reinserts BSON clones,
preserving ObjectIds and dates; validators/indexes remain installed. Upload bytes
are snapshotted/restored independently. This is deterministic state cloning,
**not a backup/restore implementation**.

Each core domain case performs an acknowledged post-S0 mutation, proves its
effect exists, then physically restores S0. External CLOSED isolation precedes
Mongo close and remains CLOSED while restored OPEN A is explicitly closed again.
The source audit must match the independently held coordinated manifest before
fresh B is installed CLOSED. B CLOSED is audited again before the synthetic
restricted-open canary. Partial-restore cases never take that open step.

The trusted manifest is held outside the restored Mongo dataset and contains
snapshot/source IDs and canonical BSON/upload digests, not profile/chat content.
The read-only audit checks complete manifest coverage, collection fingerprints,
expected indexes, matching source/control lineage, stable CLOSED control/expectation, upload fingerprints, orphan
files and broken references. It reports reconciliation-required without repair,
receipt synthesis, deletion or reopening. Tests observe actual Mongo commands and
assert no audit insert/update/delete/schema mutation. A matching digest cannot
establish the trustworthiness of an untrusted manifest or undo missing evidence.

## Domain and race evidence

| Scenario | Evidence |
| --- | --- |
| Progress completion/reset | Post-S0 XP/progress/reset effects roll back; old A is rejected without changing restored state; fresh B action succeeds. Restored epoch is deliberately 5 on both lineages. |
| Flashcard create/review/update/delete | Post-S0 effects/scheduling roll back; A cannot replay despite restored resource/receipt state; fresh B gets a new operation ID. |
| Community create/update/delete/reaction | Post-S0 domain/receipt effects roll back; old A cannot reuse restored revision 0, delete the restored post or change its reaction. Stale multipart create allocates no file. |
| AI send | Restored-away messages/receipt/barrier stay absent for old A; provider-call count cannot increase; fresh B send succeeds. |
| AI clear original hazard | S0 contains M1/M2 before clear K. Clear/receipt/barrier commit, then S0 restoration removes K and rolls barrier revision back. B adds later messages. A K is rejected before receipt lookup, barrier update, delete or transaction; all four messages remain. |
| Historical unsafe control | A separate synthetic Mongo collection copies restored and later messages; receipt-miss/delete-all without a fence deletes all four there. Current runtime messages remain untouched. No unsafe runtime path is introduced. |
| Domain transaction versus Mongo close | Real transaction stages domain and receipt writes under snapshot A, then an actual operator close commits before its fence touch. Real write conflict/fence abort leaves neither domain nor receipt committed. No mocked fence. |
| Actual AI clear versus external close | Pause after transactional message deletion, close independent latch, begin Mongo close, resume. Clear aborts; messages/barrier/receipt remain unchanged and Mongo close completes. |
| Provider already in flight | Fake provider blocks inside send, independent latch closes and Mongo close starts, provider returns once. Final commit aborts; messages/barrier/receipt do not commit. Already-started external calls cannot be cancelled by the DB fence. |
| Image preparation across restore | Actual server normalization pauses across physical A rollback/B activation; old request cannot adopt B or persist a post/file. Native client preparation preserves durable A evidence before preparation and explicit B re-entry uses a new ID. |
| Upload compensation | Close after owned image staging aborts DB commit and removes only that owned file; unrelated bytes remain and traversal removal is rejected. |

High-risk cases use synchronization barriers, not timing sleeps: AI-clear physical
restore replay **10/10**, real transaction close **10/10**, server image preparation
**10/10**, native Community preparation **10/10**, stale-instance configuration
**10/10** in the focused run. The full baseline repeats these cases.

## Partial recovery and uploads

| Mismatch | Detection | Write state |
| --- | --- | --- |
| Send domain survives, receipt lost | Receipt manifest mismatch | CLOSED |
| Receipt survives, message effect lost | Domain manifest mismatch | CLOSED |
| Clear receipt survives, barrier lost | AI barrier manifest mismatch | CLOSED |
| Clear barrier survives, receipt lost | Receipt manifest mismatch | CLOSED |
| Older Mongo, newer uploads | Orphan and upload manifest mismatch | CLOSED |
| Newer Mongo, older uploads | Broken reference and upload manifest mismatch | CLOSED |
| Coordinated older Mongo/uploads | Matching manifest; audit itself still opens nothing | CLOSED until explicit canary |
| Divergent instance disk | Broken reference/upload mismatch; both instances can read the actual shared tree | CLOSED |
| Missing manifest, wrong source lineage or expected index evidence | Unverified manifest/source/index finding | CLOSED |

No audit deletes or regenerates evidence to pass. Selected collection fingerprint
coverage is explicit; semantic reconstruction without trusted coordinated evidence
is outside this drill. Mongo-local audit/issued-ID history can also roll back.
Known A reuse is rejected using surviving events; complete historical non-reuse
still requires independent issued-ID retention outside Mongo.

## Multi-instance and reopening matrix

Both real instances report B/OPEN and can commit fenced writes through the shared
database. An already-running A-configured instance is unready and cannot mutate B.
Mongo CLOSED blocks both even with previously cached OPEN readiness. Missing,
duplicate (validation bypass simulating corruption), malformed, invalid-state and
unavailable control fail closed with safe 503 and no repair. External expectation
mismatch and independently CLOSED latch also block writes. Recreating Nest
instances under ordinary A or B restart/scale-out changes neither timeline nor
control-event history. Code rollback alone must not allocate a data timeline;
timeline-incapable code remains incompatible and cannot authorize reopening.

The reusable `restoreReopeningMatrix` lives in the test fixture:

| External timeline/mode | Mongo timeline/gate | Protocol | Client timeline | Result |
| --- | --- | --- | --- | --- |
| A/OPEN | A/OPEN | 2 | A | Allow baseline |
| B/CLOSED | B/CLOSED | 2 | B | 503 |
| B/OPEN | B/CLOSED | 2 | B | 503 |
| B/CLOSED | B/OPEN | 2 | B | 503 |
| B/OPEN | B/OPEN | 2 | A or unknown C | 409, no effect |
| B/OPEN | B/OPEN | 2 | Malformed | 400 |
| B/OPEN | B/OPEN | 2 | Missing | 428 |
| B/OPEN | B/OPEN, unmarked transitional fixture | 1, ALLOW_LEGACY | None | Transitional admission; origin unprovable |
| B/OPEN | B/OPEN | 1, ENFORCE_MUTATIONS | None | 426 |
| B/OPEN | B/OPEN | 2 | B | Allow restricted canary |
| A/OPEN | B/OPEN | 2 | B | 503 |

Known restored B independently refuses ALLOW_LEGACY, including a matching header.
A legacy success is **not** post-restore reopening evidence. Matching B also grants
no ownership privilege: another owner's delete is rejected. Surviving A receipts
prevent reuse of A IDs as new B work; disappeared receipts remain protected by the
original A header. Explicit fresh client actions allocate new IDs.

## Client reconciliation

Web tests reopen the same persistent browser origin with A intents, discover B,
reject replay/relabeling, invalidate A feed authority, ignore in-flight A success
and 401, and create fresh B IDs for AI clear and Community create. Pre-timeline
queue/clear records remain unchanged and unverified after first B discovery.

Flutter tests reopen real native two-slot files for AI clear, Community create
and progress, restore cached A as non-fresh, discover B, reject dispatch, invalidate
acknowledged A progress reads and preserve old IDs/payloads. Both stale success
and 401 remain fenced. Legacy records are never stamped. These client harness
tests simulate server discovery/responses; they are not a live browser/device
network run against the disposable Nest applications.

## Shared-control contention

Focused 94-test run, two application/connection contexts; small synthetic domain
insert per transaction. Commit latency p50/p95 counts successful requests only.
This is **not a production capacity benchmark or SLA**.

| Concurrency | Commits | Retries | Mongo write conflicts | Bounded 503 failures | p50/p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 0 | 0 | 24/24 |
| 4 | 4 | 5 | 5 | 0 | 57/74 |
| 8 | 8 | 24 | 24 | 0 | 138/282 |
| 16 | 16 | 69 | 69 | 0 | 233/517 |
| 32 | 23 | 245 | 254 | 9 | 629/908 |

Earlier focused schedules also exhausted the 12-attempt budget at concurrency 16;
counts/timings vary. Functional correctness requires exactly the successful domain
inserts and fence increments, no rejected-operation effect, and safe bounded 503
failures. All these assertions pass. No read-only fence fallback, retry-budget
increase or fence optimization was introduced. Burst capacity and controlled
canary load are deployment requirements for 10F/deployment. Limits remain
process-local: control instance count and use trusted ingress/global limiting or
a separately reviewed shared limiter for horizontal scale. All instances require
the same persistent upload tree; divergent local disks are unsafe. No Redis or
object-storage migration is included.

## Tests, observability and limits

Drill suites: backend `restore-drill.spec.ts` **95**, web
`restore-drill.test.cjs` **7**, native `restore_drill_test.dart` **20** (122 total).
The normal full baseline automatically discovers these tests. Safe telemetry
assertions cover mismatch, closed admission, legacy admission, receipt conflict
and fence retries without tokens, prompts, replies or file content.

The drill does not prove witnessed production restore, backup tooling durability,
independent control-store provisioning, external credential rotation/revocation,
whole-process crash/power-loss safety, production latency/capacity, global rate
limits, device/browser deployment or signed store artifacts. External isolation,
provider-side effects already started, coordinated backup retention, immutable
external manifests/issued-ID history and explicit operator reopening remain
mandatory. No enforcement/default/traffic changes are made.

Next: **10F — final architecture and recovery audit**, only after review/approval.
