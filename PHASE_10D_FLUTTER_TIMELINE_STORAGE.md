# Phase 10D — Flutter timeline-aware durable storage

Backend, web and Flutter now declare client protocol **2**. This changes no
server enforcement setting: the staged default remains `ALLOW_LEGACY` with
minimum mutation revision 1. Global `ENFORCE_MUTATIONS`, deployment, merging
and production traffic are separate decisions.

## Authority, persistence and ordering

`DataTimeline` validates the public, canonical lowercase UUID v4 returned by
`GET /compatibility` through `backend_http`. Protocol metadata and the
timeline write state must also be valid. Missing, malformed, unavailable or
closed discovery disables durable dispatch; no replacement ID is generated.

States are UNKNOWN, CURRENT, CHANGED and UNAVAILABLE. A cached
`lastConfirmedDataTimelineId` permits new known-offline work, but is not fresh
server authority. CHANGED/recovery stays visible after successful B reads.
Only discovery can confirm authority. Failure does not erase the last known ID.
A valid CLOSED B still replaces A read authority and invalidates A responses,
while durable dispatch remains blocked until an OPEN discovery confirms B.

Native storage still uses `FileSyncStorage`: alternating generations, checksums,
serialized writes, flushed promotion, and explicit corruption recovery with a
verified previous snapshot. There is no new single-file or preferences-only
native persistence design. The Flutter web adapter retains its prior preference
implementation; native guarantees apply to native targets.

The existing queue and online-intent collection remain. A small additional
online-only evidence collection uses the same two-slot implementation in
`sync-v1/direct-evidence`. Global timeline metadata uses a reserved
`timeline_global` record in the existing queue storage. Local file generation
orders snapshots; `dataTimelineId` identifies server lineage. They are independent.

Startup restores the active owner queue, online intents and direct evidence,
then cached timeline metadata. Corruption keeps the recovery screen and prevents
draining. Connectivity probes health and compatibility before announcing backend
reachability. Services, the coordinator and online recovery independently guard
dispatch so a screen cannot bypass discovery. Reconnect validates compatibility,
publishes the confirmed lineage, invalidates reads and only then wakes drains.

Each new record captures its timeline before persistence or dispatch. Replay
reads the record's immutable timeline and recorded protocol. Copy/retry/receipt
methods preserve timeline metadata. There is no timeline-rebinding operation.
Server timeline admission errors pause work and force new discovery; they do not
turn it into terminal validation failure. A stalled A record cannot prevent
eligible B records from being considered.

## Mutation inventory

| Writer | Persistence and replay classification |
| --- | --- |
| Progress completion/reset | Existing owner queue; timeline plus progressEpoch/expectedEpoch and stable operation ID, before optimistic state or network. B requires refreshed B progress, even if epoch numbers match A. Reset receipt reads use the saved operation's timeline. |
| Flashcard create/review/update/delete | Existing owner queue on both online and offline paths, before dispatch. Scheduling state is retained for reviews; create dependencies and mappings retain timeline provenance. Compaction and dependent rewrites cannot cross timelines. A failed drain keeps its optimistic card until reconciliation. |
| Community create, including selected files | Existing bounded online-intent journal. Fields and exact file bytes are persisted with owner, language, operation ID, protocol and timeline before upload. No automatic resend across timelines. |
| Community update/delete/reaction | Online-only evidence journal at the central boundary. Retains method/path, operation ID, revision, fields/body, exact upload bytes and desired reaction state. No background replay. A stable-key retry must match the original payload and timeline. New B actions require refreshed post state; a delete dialog opened on A cannot authorize B. |
| AI send/clear | Existing online-intent journal; owner, language, timeline, protocol and durable conversation identity. Conversation identity is scoped by timeline and language. Same-timeline ambiguous recovery retains its original ID. A records remain visible for reconciliation; an explicit new B action creates a different ID. |
| Persistent profile name/target-language changes | Online-only evidence journal before HTTP. Backend target-language evidence precedes persisting the optimistic preference. Old responses cannot update a new profile or selection. |
| Registration/server guest creation | Online-only, non-replayable boundary evidence capturing timeline before HTTP. Passwords, tokens and registration email are excluded from retained auth evidence. No credentials are stored for automatic replay. |
| Login | No server durable mutation; no outbox or automatic replay. Late responses are timeline-guarded. |
| Writing checks/pronunciation assessments | Stateless server/provider evaluations, not durable server writers and not queued. Existing owner/language response checks remain. |
| Selected images/audio, external media, device file reads | Outside backend mutation protocol. `getMedia` adds neither protocol nor timeline headers, even for media sharing backend origin. |
| Local guest progress/cards, theme, sound, UI language | Local-only state; no server mutation or backend replay. |

Online-only evidence is bounded (32 unresolved records and 8 MiB per owner).
The existing online journal remains bounded at 8 intents and 8 MiB. Capacity
refuses new work rather than evicting evidence. Auth outcomes cannot be replayed
from their credential-free evidence. Other online-only records require refresh
and user re-entry rather than a background sender.

## Restore, legacy and isolation

Missing operation timeline means LEGACY_UNVERIFIED. Original IDs, payloads,
owners, protocol, languages, revisions, epochs and failure metadata are retained.
Discovery B never stamps them B. Legacy read checkpoints are not promoted into
current progress state. A records likewise retain A after B is confirmed.

Owner identities remain `registered_<id>` and `guest_<id>`, never email-derived.
Switching owners pauses the original owner's work and exposes only the active
owner's collections. Switching back exposes the original evidence. Tokens and
owner identity are not cleared by a timeline change.

AI clear is never converted from A to B. A pending clear survives restart and
cannot dispatch or acknowledge on B. A fresh B clear requires a fresh user
confirmation and operation ID. The recovery notice permits explicit local-only
discard of a selected stale online intent; discarded IDs have tombstones and
cannot be reused. Discard sends no HTTP. Other pending records remain untouched.

The persistent notice does not disappear because a B response succeeds. Current
history must be refreshed and old actions reviewed. Read-only recovery does not
implicitly discard or reactivate write evidence.

## Cache inventory

| State | Classification and invalidation |
| --- | --- |
| Acknowledged progress, epochs and checkpoints | TIMELINE_SCOPED. Preference keys include timeline; durable checkpoint provenance is checked before projection. B refresh may accept a lower B epoch without rewriting A operations. |
| Flashcard deck and scheduling projections | TIMELINE_SCOPED by owner, language and timeline. In-memory decks clear/refetch on timeline change. A cache and unresolved queue evidence remain separate. |
| Community feed/pages | TIMELINE_SCOPED by owner, language, pagination and timeline. Stale snapshots cannot satisfy a B query. Mounted views clear/refetch. |
| AI history and pending visible results | TIMELINE_SCOPED by owner, language, conversation/session and timeline. History reloads on change; late send/clear results cannot land in a new view. |
| Public profile display | TIMELINE_SCOPED. One serialized owner/session/timeline projection contains the profile fields and provenance; writes are serialized and fenced again before persistence. Legacy per-field timeline tags cannot authorize profile data. Stale display fields are unavailable until B refresh, while identity/token remain intact. |
| Server lesson catalog/details and progress-derived availability | TIMELINE_SCOPED. Cached keys include timeline; the home catalog refreshes. An active A lesson session cannot create B progress. |
| Bundled lesson/reference data | TIMELINE_NEUTRAL; local fallback remains usable, but server-bound completion still needs current progress/timeline authority. |
| Local guest data and device UI settings | TIMELINE_NEUTRAL. No server ownership or server history is inferred from them. The selected UI language is distinct from confirmed backend profile data. |

Legacy server read caches without provenance are ignored conservatively.
Central response guards reject requests that began on A and returned after B.
Session guards additionally protect owner/token and language/session boundaries.
Checks also cover deferred cache projection, confirmations, flashcard slideshow
timers and active lesson sessions.

## Review validation

`test/data_timeline_test.dart` exercises real native two-slot stores, reopen,
unknown/offline creation, first v2 startup with legacy evidence, malformed
discovery, A → B queue blocking, independent progress epochs, upload/auth evidence,
AI clear discard/new identity, late responses, timeline admission failures and
external-media isolation. AI widget tests cover history/send/clear on timeline
change and an A confirmation that cannot authorize a B clear. Existing durability,
corruption, owner/language/session, retry and coordinator suites remain required.

## Corrective regression coverage

Community create now commits a `preparing` intent containing its original owner,
timeline, ID, submitted fields and selected filename before file/media awaits.
Preparation completion can fill that same record with exact bytes only while the
captured context remains current. A timeline change preserves the A preparation
record and requires explicit B re-entry with a new ID. Incomplete preparation
records cannot drain. The existing complete-intent byte limits and missing-source
retry behavior remain intact.

Auth invalidation checks owner/token, session revision and timeline revision
immediately before logout, including after an awaited queue checkpoint. Profile
projection persistence uses one serialized JSON value carrying schema, owner,
token-derived session identity, timeline and data. A stale continuation cannot
write a current profile projection; legacy authentication keys do not establish
profile authority. Session persistence is awaitable; login/registration and
account-switch widget fixtures wait for it and revalidate before continuing.

Native storage reads pending files back after flush/close and verifies JSON,
checksum, expected local generation, schema and owner before slot replacement.
Failure leaves both prior verified slots untouched. Owned failed pending files
are ignored during recovery and may remain for diagnosis. File flush/rename do
not prove directory-fsync, process-kill or power-loss durability.

Machine-readable recovery retains status/code and distinct classifications:
409 timeline reconciliation, 428 unverified/missing provenance, 426 client update,
503 maintenance/backoff, and 401 current-context authentication failure. Timeline
and provenance errors pause automatic replay without relabeling or autofill.

Focused additions:

- `test/timeline_corrective_test.dart`: 7 deterministic tests covering both file
  preparation outcomes, the checkpoint/auth race, both profile interleavings,
  failed atomic profile persistence and AI-clear discard followed by restart.
- `test/sync_promotion_verification_test.dart`: 11 tests covering actual partial
  writes/write failure, invalid JSON, bad checksum, incorrect generation/owner/
  schema, failures after flush and before promotion, dependent HTTP suppression,
  and corrupt-newest/verified-A-backup recovery under B.
- `test/timeline_error_contract_test.dart`: 35 tests covering actual HTTP statuses
  independently for queues/intents; in-flight success and all five error statuses
  across Community, AI, progress and profile; and a backend-inventory parity test
  exercising persistence-before-HTTP and immutable retries for all 15 writers.

These are deterministic filesystem/continuation failure injections and reopen
tests; they do not simulate a physical power loss or process termination.
