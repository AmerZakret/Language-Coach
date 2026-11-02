# LinguaAI — Offline Capabilities Document

This document explains the design, behavior, and capabilities of the LinguaAI Web and Mobile applications when running in offline mode.

---

## 1. Feature Classification

To ensure a high-quality user experience without active internet connection, LinguaAI categorizes its features into two main classifications:

### 🟢 Offline-Friendly (Fully Supported Offline)
These features allow reading cached data and queueing actions locally to be synchronized later.
*   **Curriculum & Lessons**: Fetch and play lessons from the local cache. Track completions and XP locally.
*   **Flashcards**: View card decks, create new cards, update, review (calculates spaced repetition scheduling locally using SM-2 algorithm), and delete cards.
*   **Progress Stats**: View XP, level, streak count, and weekly activity based on locally cached statistics.
*   **Community Feed**: Read cached posts fetched during the last active session.

### 🔴 Online-Only (Locked/Blocked Offline)
These features require real-time processing from the backend server or AI services and are blocked when offline.
*   **AI Coach Chat**: Real-time conversation with the Gemini-powered language coach.
*   **Writing Practice Assessment**: Grading and grammar corrections from the AI.
*   **Pronunciation Practice Assessment**: Speech-to-text validation and pronunciation analysis.
*   **Community Actions**: Creating new posts, editing existing posts, deleting posts, or liking posts.

---

## 2. User Experience in Offline Mode

### Web App Dashboard
*   **Sticky Global Warning Banner**: Appears immediately below the main header notifying the user that they are viewing cached data offline.
*   **Page Overlays**: Visiting the AI Coach, Writing Practice, or Pronunciation Practice screens renders a full-page "Connection Required" overlay.
*   **Disabled Actions**: The post creation form and like buttons on the Community Feed are hidden or disabled.

### Mobile App (Flutter)
*   **Top Alert Banner**: A colored banner slides in under the AppBar when connection is lost.
*   **Empty State Layouts**: The AI Coach, Writing, and Pronunciation screens display a friendly icon (`wifi_off`), title, and explanation message, blocking all form submissions.
*   **Disabled Community Operations**: The post composer card is hidden, like buttons display warning SnackBars upon tapping, and popup menus for editing/deleting posts are blocked.

---

## 3. Data Syncing & Queueing Mechanism

LinguaAI does not lose progress made offline. When offline mutations occur, they are managed chronologically in a local queue:

1.  **Queueing**: Completing lessons or managing flashcards offline saves the exact action before acknowledging it locally (`localStorage` on Web, flushed owner files on Flutter mobile/desktop). Flutter web retains its existing SharedPreferences queue.
2.  **Reconnection Check**: Once the app detects that internet is restored, it triggers the synchronization worker.
3.  **Conflict & ID Mapping Resolution**: 
    *   Offline-created cards use temporary IDs (e.g. `local_1717900000`).
    *   Upon syncing `create-flashcard`, the backend saves the card and returns its official MongoDB ObjectId.
    *   The sync worker maps the temporary ID to the new database ID and rewrites subsequent queued actions (updates, reviews, deletes) that reference that card, maintaining integrity.
4.  **Concurrency Lock**: Flutter uses owner-specific drain exclusion and separate serialized queue mutations to prevent overlapping drains or lost queue updates.

## Phase 7D: native queue durability and retained evidence

Flutter Android/iOS/Linux/macOS/Windows sync state lives under the application's
persistent support directory, in `sync-v1`. `path_provider` and `crypto` were
already resolved dependencies; they are now direct dependencies for locating
that directory and SHA-256 corruption detection. No database is introduced.

| State previously stored in SharedPreferences | Classification / new authority |
|---|---|
| Active actions, original IDs/payloads/epochs/owners | CRITICAL_DURABLE: owner file |
| Failed/quarantined actions and error/recovery evidence | CRITICAL_DURABLE: owner file |
| Started-create markers, temp-ID maps, dependent rewrites | CRITICAL_DURABLE: same owner file |
| Active retry/backoff metadata | CRITICAL_DURABLE: part of its action |
| Reset barriers and progress revisions | CRITICAL_DURABLE: same queue record |
| Owner progress epoch and acknowledged progress checkpoints | CRITICAL_DURABLE: same owner file |
| Preference epoch / acknowledged progress display snapshots | RECONSTRUCTABLE: projected from the owner file |
| Server lesson/card/feed caches and ordinary UI settings | CACHE_ONLY; unchanged |

Auth/session preferences remain in their existing independent storage. Durable
queue ownership is the validated ID namespace in the record, never an email.

Each owner (`registered_<id>`, `guest_<id>`, `local_guest`) has two checksummed,
generation-numbered committed slots. `legacy_unowned` is a separate diagnostic
record, never a replay owner. A replacement is serialized to a unique `.pending`
file, written and flushed with `RandomAccessFile.flush`, closed, then renamed
onto the older slot. The newest valid slot is never removed before promotion.
Readers ignore uncommitted `.pending` files. The commit promise resolves after
promotion; notification, queue acknowledgement and successor dispatch follow it.
Create acknowledgements include the temp mapping, dependent rewrites, action
removal and started-create removal in one commit. Completion/reset checkpoints
include their epoch and revision in that commit. Preference display projection
runs afterward and may be retried without undoing an acknowledged operation.

This establishes a stronger process-crash persistence boundary than preferences.
It does **not** promise complete power-loss durability: portable Dart exposes no
directory fsync here, so directory-entry persistence and hardware behavior remain
platform-dependent. File rename behavior can vary across platforms; replacing
only the older slot preserves the newest copy even if replacement is interrupted.
Interrupted staging files are retained as evidence, not adopted or age-cleaned.

Both committed slots are checked for schema, owner, generation and checksum.
If either is corrupt, replay/writes stop with a safe diagnostic; verified backup
data is exposed on the corruption exception and both files remain untouched.
Automatic rollback is unsafe because an older snapshot may omit pending work or
a dispatched-create marker. Startup displays a storage-recovery message and
runtime sync exposes `lastStorageError`; no destructive recovery UI is added.
I/O/permission failures remain failures, not empty queues. Ordinary missing files
are empty only before an owner has stored state.

Migration is lazy per owner on its first access (the active owner is checked at
startup). Only validated, explicitly owned v1 action lists/v2 queue envelopes
are adopted. The file commit is the migration marker; preference queue retirement
happens afterward. Existing native files take precedence over leftover preferences,
including after interruption between those steps. Ownerless work and invalid
owned migration candidates are copied to durable diagnostic quarantine without
inferring identity; invalid owned candidates remain blocked and preserved.
Inactive owners' old preference entries remain intact until their own migration.

The app has one queue-writing primary isolate/process and no background isolate
sync writer. Queue mutations use the existing per-owner read/modify/write locks;
file access adds serialization across storage instances at the same root. HTTP
never holds the mutation lock. Multiple app processes or future isolate writers
require explicit coordination before they may share these files.

No pending/failed work expires by age. Original operation IDs, epochs and failure
metadata survive migration and restart. Explicit existing cancellation semantics
remain supported. Temp mappings are retained: cached card IDs can still reference
them, and complete reference/replay proof is unavailable. `storageDiagnostics()`
reports current-owner action/failed/map/started-create counts without payloads;
no public endpoint or production sweep is introduced. Storage grows with retained
receipts, failures and mappings; replacing old *snapshot copies* never expires
logical records. Flutter web and the separate web application are not migrated.

## Phase 7E: online mutation replay and session ordering

Community mutations and AI send/clear remain online-only. There is no existing
Community/AI offline dispatch path to migrate; no new offline feature is added.
The existing flashcard/progress queues keep their original durable operation IDs.

Flutter and web generate an operation ID once for each Community/AI logical
mutation and send it as `X-Idempotency-Key`. An uncertain transport/server failure
gets one bounded retry with the original payload, key and captured credentials.
Unacknowledged create/edit/delete/send/clear intents keep their keys for a retry
in the current form/service; changed intent or acknowledged intentional repeat
gets a new key. Explicit API callers may supply an operation ID for cross-device
replay. These online intents are not a newly introduced durable offline outbox:
form/service disposal or browser/app restart does not restore them. Broad failed
action recovery and an online outbox are deferred.

Flutter captures multipart image bytes and rebuilds requests, including an
explicit retry after the original temporary local file disappears. Web retains
its FormData/File. Backend replay uses durable receipt results and a bytes-based
fingerprint, with no dependence on a server staging path. Unacknowledged Flutter
upload snapshots remain in that service's memory until acknowledged/disposed.

Reactions set explicit desired `liked` state. Same-device requests for a post
dispatch in intent order. UI count acknowledgements use authoritative backend
values or a refetched feed; replay never adds another local count delta. Edits
and deletes carry the displayed post revision. Community cache invalidation
retains existing owner keys and additionally checks the captured view before
changing relevant entries. Old owner/language/view acknowledgements cannot
invalidate the replacement view's cache or mutate its UI.

AI owner/language/revision response guards remain active through send, clear,
history reconciliation and session/language ABA switches. A clear acknowledgement
loads current authoritative history rather than blindly clearing the UI again.
Server receipt/barrier transactions preserve sends committed after an earlier
clear, even when the clear response was lost. An acknowledged clear ends the old
local send retry intent captured when that clear was created; it never retires
a later send's unresolved key. Connectivity changes retain unresolved web AI
send/clear IDs. Receipt acknowledgements merge history by durable message ID,
so replay after history reload cannot append the same displayed pair twice.
Web synchronous dispatch guards also exclude same-render duplicate AI sends.
Flutter's language-view generation scopes unresolved local AI intents: a new
action after an X-to-Y-to-X switch gets a fresh ID, while same-view retries keep
the original ID. Explicit caller-supplied IDs still permit cross-device replay.
Community acknowledgements retire only their own pending intent; selecting a
different image creates a distinct intent even if file metadata matches.
Current-session 401 invalidation still preserves owner queues and caches; stale
401s cannot invalidate replacement credentials.
