# Client mutation recovery

Phase 9D reuses the Phase 7 server receipts/barriers and the Phase 9C recorded
client protocol. It adds no receipt lookup endpoint or server mutation protocol.

| Operation | Recovery model |
| --- | --- |
| Community create | Durable intent before the first mutation request, including exact selected image bytes. Replay the same ID/payload. |
| Community update | Refresh reconciliation. Retain the original revision/key during the live attempt; never automatically apply an old edit over a refreshed revision. Reopen the editor to edit newer data. |
| Community delete | Refresh reconciliation. A resource-specific 404 confirms absence. A revision conflict never forces deletion. |
| Community reaction | Refresh authoritative desired state/count. The live transport retry retains its key; no persistent toggle history. |
| AI send | Durable exact message/language payload and operation ID; replay restores the committed pair without another provider call. |
| AI clear | Durable original clear ID/language. Replay returns the original clear receipt and cannot erase later messages. |

## Lifecycle and ordering

1. Capture the active authoritative session and owner (`registered_<id>` or
   `guest_<id>`), never an email. Local-only guests cannot submit these mutations.
2. Freeze the payload, assign a stable operation ID, and persist the intent
   **before** the first mutation/provider-backed request. Attachment preparation
   rechecks the captured session before persistence/dispatch. No token is saved.
3. Dispatch the recorded payload and protocol using current credentials for that
   same owner. Page/widget disposal does not cancel or erase the journal.
4. A successful HTTP response first checkpoints the acknowledged result. Validate
   the public acknowledgement and perform any required Community cache
   invalidation, then remove **only that acknowledged ID**. If checkpointing,
   cache acknowledgement, or final removal fails, preserve recovery evidence.
5. On page initialization, connectivity recovery, or explicit recovery, reconcile
   a bounded snapshot serially. History/feed reads remain available when recovery
   pauses or fails; notices explain pending/conflicted work. A stale session or
   language cannot inject results into a replacement view. Loading history during
   an already-running native dispatch does not start a duplicate recovery.

An ambiguous request does not authorize a different draft/new ID in its slot.
Each owner/language has at most one unresolved operation of each kind. AI send
and clear additionally block each other in that conversation until the earlier
action is reconciled. This deliberately prevents a first-time, delayed clear
from running after a later send. Once a clear is acknowledged, replaying its
original receipt remains safe even after later sends; server integration tests
exercise that barrier/receipt guarantee against disposable replica-set Mongo.

Pending user bubbles are replaced on retry and resolved with authoritative
message IDs. Restart recovery loads authoritative history rather than appending
another speculative pair. A failed or conflicted action remains explicit, blocks
replacement in its slot, and requires reconciliation/support; it is never silently
dismissed or assigned a fresh ID. There is no automatic cancellation of an
ambiguous operation.

## Storage and concurrency

Web uses `linguaai_online_intents_<encoded owner>` alongside existing owner-scoped
browser storage. It reuses the existing owner **storage** and **drain** Web Locks,
always rereading after lock acquisition. Other tabs receive storage events and
update their recovery notice. Concurrent drains cannot dispatch an acknowledged
operation again. Browsers without Web Locks fail before dispatch; there is no
unsafe localStorage lease fallback. No auth or offline queue key is cleared.

Native Flutter uses the existing `FileSyncStorage` mechanism in the application
support `sync-v1/online-intents` directory: two alternating slots, generation,
checksum, flush and promotion, with serialized owner writes/drains. It does not
replace the existing offline queue or weaken its migration/epoch checkpoints.
Flutter web retains the existing preference adapter; the dedicated React web
client provides the cross-tab Web Locks contract.

Both journals validate version, owner, language, protocol, operation identity and
payload shape; they contain no token. Limit: **8 unresolved/acknowledging records
and 8 MiB serialized data per owner**, including results and base64 image bytes.
Images remain limited to 5 MiB, with browser quota possibly imposing a lower
practical limit. Storage/capacity failure rejects a new mutation before dispatch.
There is **no TTL, automatic eviction, or unresolved-record cleanup**. Only
authoritatively acknowledged records are removed. Fixed-category browser recovery
diagnostics contain no message text, image bytes, owner IDs or tokens.

Corruption fails closed and preserves evidence. As with the Phase 7 queue, a
corrupt native slot exposes any verified backup via `SyncStorageCorruption` for
recovery diagnostics, but does **not** automatically promote/replay/overwrite an
older snapshot: it may omit newer work. New writes/replay remain blocked until
that evidence is reconciled. A backup is not proof that no newer operation exists.

## Failure classification

| Outcome | Client behavior |
| --- | --- |
| Transport loss, timeout, busy/503 | Outcome remains ambiguous; retain the original ID/payload. The existing transport permits at most one immediate retry. Later recovery uses persisted exponential backoff (5 seconds to 5 minutes). |
| 429 / numeric Retry-After | Preserve intent and ID; honor bounded Retry-After (maximum 5 minutes). A positive Retry-After prevents an immediate transport retry. |
| Current-session 401 | Existing authentication handling runs; old-owner intent survives logout. Reauthentication as the same owner can resume; another owner cannot inherit it. |
| Protocol 426 | Preserve the original recorded protocol and pause dispatch. Require client update or explicit supported reconciliation; do not relabel, delete or quarantine the intent. |
| Payload/revision conflict | Retain explicit failed/conflict evidence. No replacement key or blind revision advance. |
| Terminal validation/authorization failure | Retain explicit failed state; no endless automatic retry. Authoritative reads remain usable. |

Recovery is intentionally limited to these online create/send/clear operations.
It is not a general offline outbox and adds no disaster-restore generation fence.
Server rollback consistency remains governed by the coordinated recovery runbook.

## Packaging boundary

Owner journals and native durable slots are client STATE, never release artifacts.
Preserve them across updates/rollback and retain their original IDs/protocols. See
[Release packaging](RELEASE_PACKAGING.md) for artifact/config/state separation.


## Phase 10C web timeline provenance and restore review

Every new server-bound web operation captures a confirmed dataTimelineId before
queue/intent persistence or dispatch. The operation keeps that identity forever.
Offline creation is allowed with a previously confirmed cached timeline; a browser
that has never confirmed one blocks new replayable work. Reconnect discovers the
server timeline under coordination before considering drains. IDs are public
preconditions, never credentials or proof of ownership.

Old no-timeline records are LEGACY_UNVERIFIED (derived classification). They keep
their owner, operation ID, payload, protocol and evidence indefinitely. Neither
first confirmation nor retry code assigns the current timeline to them. Corrupt
stores stay intact and block dispatch. Migration does not evict unresolved work.

After A becomes B, A work remains saved and paused, including AI send and the
particularly destructive ai-clear. An old clear cannot execute in B or be relabelled.
Review the saved payload and current history/feed, then discard a selected old local
record only through explicit confirmation. Discard issues no server request. Any
fresh B clear needs the existing explicit clear confirmation and a new operation ID.
The same fresh-action rule applies to sends, Community edits/deletes/reactions,
flashcard actions, and progress (whose epoch is independent of timeline).

409 SERVER_TIMELINE_CHANGED pauses for reconciliation and rediscovery; 428
SERVER_TIMELINE_REQUIRED is a provenance problem, never latest-timeline autofill.
426 retains update-required handling; 503 BACKEND_NOT_READY pauses for maintenance
with bounded retry. Authentication/owner rules remain separate.

| Read state | Classification | Restore handling |
|---|---|---|
| Progress snapshots and acknowledged epoch | TIMELINE_SCOPED | Tagged envelope; reject unknown/A in B, refetch epoch and progress. |
| Flashcard all/due snapshots | TIMELINE_SCOPED | Tagged envelope, owner keys retained, authoritative B cards/history. |
| Community personalized feed | TIMELINE_SCOPED | Schema 3 includes owner/query/timeline; reject A and untagged caches. |
| AI history/results | TIMELINE_SCOPED | Memory only; remount/refetch and reject late A responses. Intents survive separately. |
| Cached user profile | TIMELINE_SCOPED | Auth record retains identity/token; profileDataTimelineId tags new profiles. Refresh /users/me before restoring dependent views. |
| Downloaded lesson catalog and progress-derived UI | TIMELINE_SCOPED | Discard catalog snapshots and derived views; refresh. |
| Bundled immutable fallback lesson/reference data, theme, sound, interface preferences | TIMELINE_NEUTRAL | Retain. |
| Tokenless local guest work | LOCAL_ONLY | Retain local durable progress/cards, never adopt into server queues. |

Global timeline advertisements never transfer owner journals or clear auth. A
waiting drain rereads advertisement and server state after its Web Lock. Request
contexts include a memory revision so A responses, including A-to-B-to-A races,
cannot populate a newer view/cache or resolve a newer intent. Same-timeline
rediscovery is idempotent and keeps caches and operation IDs.

Web is timeline aware; Flutter remains v1 until 10D. ALLOW_LEGACY remains
transitional. External restore isolation remains mandatory; 10E performs the full
restore drill. This work does not authorize production traffic or store release.
