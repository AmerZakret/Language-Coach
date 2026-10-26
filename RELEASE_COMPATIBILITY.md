# Release identity and client compatibility

## Identity and protocol ownership

Protocol revision **2** (server), with current web/Flutter clients still at **1** is the first explicit generation. The backend definition in
`src/compatibility/protocol-contract.ts` is authoritative; web and Flutter each
have one client constant, checked against it by runtime contract tests.
It is a behavioral contract, independent of these unchanged packaging versions:
Flutter `1.0.0+1`, web `0.0.0`, backend `0.0.1`; pronunciation has no application
version. No public/marketing version is chosen here.

Revision 1 writers implement progress epochs/reset replay, owner-scoped stable
mutation keys, flashcard receipt replay, Community desired-state reactions and
expected revisions, AI send/clear receipts and clear barriers, authoritative JWT
owners/session fencing, web Web Locks/post-lock rereads, and Flutter durable
owner-scoped queue storage. A header advertises client capabilities; it never
supplies an identity or authorization. Server validation/transactions/receipts
remain mandatory even if an attacker claims revision 1.

A build ID identifies an artifact/deployment, not a protocol. Web `VITE_BUILD_ID`,
Flutter `--dart-define=BUILD_ID=...`, and backend `RELEASE_BUILD_ID` accept bounded
public identifiers (letters/digits/dot/underscore/hyphen, 1–96 characters).
Unspecified local identities are explicitly `development`. CI supplies a synthetic
run/attempt identity without changing source. Never supply secrets as build IDs.

## Wire contract and route inventory

Clients send canonical bounded decimal `X-Client-Protocol: 1`. The supported
mutation range is currently minimum 1, current 1. Supplied malformed, older or
future unsupported revisions are rejected on sensitive mutations with HTTP 426
and `CLIENT_PROTOCOL_UNSUPPORTED`; missing required headers use
`CLIENT_PROTOCOL_REQUIRED`. Responses contain fixed safe messages, updateRequired,
current/minimum revision and policy, never supplied header text or infrastructure.
This is not a 401 and must not log out the owner.

`GET /compatibility` is cheap, public and no-store. It exposes the current/minimum
mutation revision, policy and intentionally public build ID. Explicit backend
route classification is tested against all controller routes:

| Routes | Classification |
|---|---|
| Auth, root/health, compatibility discovery | NOT_APPLICABLE |
| Domain GETs, profile PATCH, writing-check, pronunciation assessment | PROTOCOL_OPTIONAL |
| Progress completion/reset | PROTOCOL_REQUIRED_WHEN_ENFORCED |
| Flashcard create/update/delete/review | PROTOCOL_REQUIRED_WHEN_ENFORCED; keyed for declared current protocol |
| Community create/update/delete/desired-state reaction | PROTOCOL_REQUIRED_WHEN_ENFORCED |
| AI chat send/clear | PROTOCOL_REQUIRED_WHEN_ENFORCED |

Unknown new mutations fail closed under enforcement; inventory tests require an
explicit classification when routes change. Read/auth availability is deliberate.

## Staged rollout and legacy flashcards

`CLIENT_PROTOCOL_POLICY` must be explicitly configured in production:

* `ALLOW_LEGACY`: migration/reporting stage. Headerless legacy mutations keep
  their existing behavior. A supplied protocol is a capability claim and must
  already be supported. Declared current-protocol flashcards require valid stable
  `X-Idempotency-Key` on all four mutations even in this stage.
* `ENFORCE_MUTATIONS`: sensitive mutations require a supported declared protocol;
  headerless clients can still authenticate/read/discover requirements.

Development/test default to the fixed migration policy. Production has no
implicit policy. Unknown policy values fail configuration validation.
There is no server-generated substitute mutation key. Historical receipt/domain
state is not removed, expired or rewritten.

Deploy backend support first with explicit ALLOW_LEGACY, then publish coordinated
web/Flutter clients that declare revision 1. Verify the cohort and reconcile/drain
headerless legacy queues before enabling ENFORCE_MUTATIONS. Monitor compatibility
rejections; never call a permanently header-optional deployment the finished
rollout. Existing pre-7A web tabs still require operator-directed closure/reload;
software in this phase cannot retroactively patch those bundles.

## Web tabs and pending work

The central API interceptor supplies the protocol while preserving auth, mutation
keys and unrelated headers. Compatibility discovery and a no-store same-origin
`/release.json` manifest are checked at startup, periodically and on focus. Hosting
must serve that manifest uncached/revalidated alongside the matching bundle and
index. A changed build prompts a user-triggered reload; an incompatible protocol
blocks sensitive writes. A service worker is not needed.

Compatibility advertisements use a dedicated backend-scoped localStorage record
and existing storage events. They never edit auth/session records or owner queues.
Every sensitive dispatch rechecks that record to close the storage-event delay.
A new build with the same accepted protocol prompts but does not discard or block
safe writes. Rejection/unsupported protocol pauses replay and shows update or
reconciliation guidance. No automatic reload or localStorage clearing occurs.

New queue actions record their submission protocol separately from their payload.
Replay retains that revision and the original operation ID. Historical actions
without protocol metadata remain headerless; they are not silently stamped 1.
An enforcement rejection pauses them intact, outside permanent quarantine. A new
client must explicitly reconcile unsupported old work; changing its protocol
number is not a migration. Queues remain owned by their original account.

## Flutter update requirement

All backend service transports use the central HTTP boundary for protocol headers
and compatibility classification, including multipart requests. External selected
image/audio URLs receive no backend protocol header. A compatibility rejection is
separate from auth/network/validation, sets an application update-required notice,
blocks sensitive dispatch and pauses the sync coordinator. Durable two-slot queue
data, IDs, owners, payloads and recorded protocol are preserved. No unsupported
action is automatically quarantined, deleted or relabeled after upgrading.

## Rollback and operational boundaries

Deploy a backend that supports the new clients before releasing those clients.
Rolling back to a backend that does not support their declared generation can
block mutations; keep discovery/auth/read access and forward-fix compatibility.
A build rollback alone does not authorize queue-schema/protocol downgrades. Never
blindly downgrade receipt, epoch, revision/barrier or durable-store contracts.
This mechanism is not a disaster-restore generation fence. Phase 9D now persists
Community create and AI send/clear intents before dispatch; see
[CLIENT_RECOVERY.md](CLIENT_RECOVERY.md). Packaging/rollback must preserve those
journals and their original protocols; see [RELEASE_PACKAGING.md](RELEASE_PACKAGING.md).

Production traffic is still unauthorized until historical Mongo credential
rotation and revocation are independently verified. Protocol/CI success proves
neither credential remediation nor live infrastructure readiness.


## Phase 10B staged server-v2/client-v1 contract

The server supports revisions 1 and 2. Revision 1 retains the Phase 9 payload/queue
contract; revision 2 adds X-Data-Timeline (canonical public UUID v4) for durable
mutations and reset-receipt recovery. Web/Flutter runtime constants and durable
queues remain v1 until 10C/10D. Release checks explicitly assert this temporary
asymmetry and report clientsTimelineAware=false; this is not release authorization.

ALLOW_LEGACY advertises minimumMutationRevision=1 and accepts pre-restore v1 writers,
while v2 always requires its matching timeline. ENFORCE_MUTATIONS advertises minimum
2 and rejects v1/missing protocol with 426. Future revisions above 2 are rejected.
The compatibility response also includes timelineAwareProtocolRevision=2,
dataTimelineId (matching known control or null) and timelineWriteState
(OPEN/CLOSED/UNAVAILABLE), with no-store and no internal control/audit metadata.

Malformed timeline is 400 INVALID_DATA_TIMELINE; missing v2 timeline is 428
SERVER_TIMELINE_REQUIRED; changed timeline is 409 SERVER_TIMELINE_CHANGED; unscoped
historical receipt under v2 is 409 RECEIPT_TIMELINE_UNVERIFIED. CLOSED/unavailable
control is safe 503 BACKEND_NOT_READY. None is authentication failure. These errors
require preserving the original durable intent for later client reconciliation;
current clients have not implemented timeline reconciliation yet.

All durable DB mutations and authoritative receipt replays use the current shared
control fence, including legacy writes. This cannot prove where a v1 intent began.
After restore, keep hard isolation/CLOSED latches until a timeline-aware cohort
exists and ENFORCE_MUTATIONS is configured before opening fresh B. Known restore
provenance blocks legacy-mode write readiness. An unannounced restore with unchanged
external control remains undetectable; enforced operator procedure is mandatory.

Receipt uniqueness stays global across timelines. Historical receipts are never
relabelled or bulk assigned a timeline. Legacy unscoped replay is transitional only;
v2 conservatively refuses it. The server validates timeline before receipt replay,
epoch/revision checks, AI barrier/provider work, file allocation and domain effects.
