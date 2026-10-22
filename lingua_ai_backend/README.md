# LinguaAI Backend API

A clean NestJS backend for the LinguaAI English learning application.

## Getting Started

Production requirements, offline preflight, credential rotation and client release
configuration are documented in [Production configuration](../PRODUCTION_CONFIGURATION.md).
Build first, inject `NODE_ENV=production` and the required configuration, then run
`npm run validate:prod` and `npm run start:prod`. Production ignores local `.env`.

1.  **Install dependencies**:
    ```bash
    npm install
    ```
2.  **Configure environment**:
    Copy `.env.example` to `.env` and update your `MONGODB_URI`.
3.  **Start development server**:
    ```bash
    npm run start:dev
    ```

## API Endpoints

### 1. Health & System
*   **GET `/health`**: Returns system status and timestamp.
*   **GET `/health/live`**: Cheap process liveness, independent of Mongo/providers.
*   **GET `/health/ready`**: Cached core readiness; 503 for database, transaction,
    critical-index or upload-storage failure. Production gates business traffic
    until ready. See the production contract for verify-only schema provisioning
    and bounded SIGTERM/SIGINT draining.

### 2. Authentication
*   **POST `/auth/register`**: Register a new user.
    *   Body: `{ "name": "John Doe", "email": "john@example.com", "password": "securepassword" }`
*   **POST `/auth/login`**: Login and receive a token.
    *   Body: `{ "email": "john@example.com", "password": "securepassword" }`

### 3. Lessons
*   **GET `/lessons`**: Get a list of all 8 beginner lessons.
*   **GET `/lessons/:id`**: Get full lesson details including questions.

### 4. User Progress
*   **GET `/progress/:userId`**: Get XP, streak, and completed lessons for a user.
*   **POST `/progress/:userId/complete-lesson`**: Mark a lesson as finished.
    *   Body: `{ "lessonId": "1", "score": 100 }`

### 5. AI Coach
*   **POST `/ai-coach/chat`**: Send a message to the AI Coach.
    *   Body: `{ "userId": "uuid", "message": "How are you?" }`
    *   Note: Currently returns a placeholder response; real AI integration coming soon.

## Tech Stack
*   **Framework**: NestJS
*   **Language**: TypeScript
*   **Database**: MongoDB (Mongoose)
*   **Validation**: class-validator


## Community image storage

Community images require an explicit absolute `UPLOAD_ROOT` in production.
Development accepts relative paths and defaults to `<backend working directory>/uploads`. Writing,
serving and cleanup use the same resolved root. Keep this directory on persistent
writable storage owned by the backend service; multiple backend instances must
share that storage. Unshared instance disks and ephemeral deployment filesystems
are insufficient. Preserve/copy existing uploads when deploying; Git does not
package runtime images. Keep a custom root outside the checkout or explicitly
ignore its path. Do not place other application assets in this directory.

Uploads stage in bounded memory (one image, at most 5 MiB) after JWT authorization.
DTO validation and post ownership checks precede permanent writes. Only JPEG,
PNG (normalized to one frame) and single-frame WebP are accepted: byte signatures, declared MIME and file
extension must agree. Sharp then decodes/re-encodes with a 16-million-pixel limit
and a five-second processing timeout, stripping metadata/trailing content and
preserving EXIF orientation in the pixels. GIF, animated WebP, SVG, XML, HTML,
unknown and malformed content are rejected. Normalized output must also fit 5 MiB.

Images get UUID filenames with detected-format extensions and exclusive creation.
Create/update DB failures remove the newly written image without hiding the
original error. Cleanup first checks for live DB references, preserving files
on a lost DB acknowledgement or unavailable DB state. Replacement saves the new
DB reference before old-image cleanup.
Deletion removes the DB post first, then cleans the image referenced by the
removed document. Cleanup failures are logged and do not undo a successful DB
operation. A process crash between disk and DB operations, or a filesystem
cleanup failure, can still leave an orphan; no production orphan sweep runs here.

Serving is restricted to server-generated raster filenames under
`/uploads/community/`, verifies actual raster content (including historical
files), and returns `X-Content-Type-Options: nosniff`. The verification cache holds
at most 128 file fingerprints and revalidates changed files. Cleanup rejects
traversal, arbitrary URLs/absolute paths, and symlinks escaping the upload root.
Uploads are public image URLs as before; post mutation still requires JWT ownership.

Image decoder dependencies must be installed for the deployment platform via
`npm ci` (including Sharp's platform-specific optional dependencies). Do not copy
Windows `node_modules` into a Linux deployment. Decoder behavior and resource
limits follow [Sharp input options](https://sharp.pixelplumbing.com/api-constructor/)
and [output options](https://sharp.pixelplumbing.com/api-output/).

## Durable sync receipt retention

There is no enforced maximum replay age. Offline requests may return months or
years later; timestamps are diagnostic, never permission to reuse operation keys.

| Record | Policy | Why |
|---|---|---|
| Flashcard create | NEVER_EXPIRE | Replay must not recreate a renamed/deleted card |
| Flashcard review | NEVER_EXPIRE | Replay must not apply SRS/history twice |
| Flashcard update | NEVER_EXPIRE | An old update must not overwrite later state |
| Flashcard delete | UNSAFE_TO_CLEAN_AUTOMATICALLY; retain | Deletion still consumes its owner/type/key |
| Progress reset | NEVER_EXPIRE | Lost-ack reconciliation must not rerun a reset |
| Completion/provenance | NEVER_EXPIRE within epoch | Natural-key evidence prevents XP re-award |

There are no TTL indexes on these collections and no cleanup job is added.
An explicit progress reset transaction may remove prior-epoch completion rows;
epoch checks then reject obsolete completion replays. Reset and flashcard receipts
remain retained across later mutations/deletions. Capacity growth is intentional
until an enforceable replay-age contract and safe operation-key reuse policy exist.

## Phase 7E Community and AI mutation contract

Community create/edit/delete/reaction and AI chat/clear require
`X-Idempotency-Key` (1–128 ASCII letters, digits, `.`, `_`, `:`, or `-`). JWT
identity, operation type and key form a unique durable receipt identity. Sorted
scalar payloads are SHA-256 fingerprinted. Receipts contain detached logical
results and commit in the same majority-write transaction as their DB effects.
Same payload replay returns that result even if the resource/history was later
deleted; changed payload returns `409 IDEMPOTENCY_CONFLICT`. No replay reruns a
destructive mutation. Independent device operation IDs remain independent.

`POST /community/posts/:id/like` now requires `{ "liked": true|false }`.
One MongoDB update pipeline sets membership with set union/difference, then
derives `likesCount` from the resulting membership. The receipt makes an old
like replay harmless after a later unlike. Opposite new operations serialize
at the post write; last committed desired state wins. Flutter and web serialize
same-device per-post reaction dispatch in intent order. Cross-device conflicting
intent has server commit ordering, without a client clock ordering assumption.

Posts expose `revision` (historical missing revisions read as zero). Edits require
`expectedRevision` in their body/multipart fields; deletes require
`X-Resource-Revision`. Only content edits increment it; reactions preserve it.
Transactions recheck ownership and revision after write conflicts. First-time
missing resources return 404; only a matching receipt proves a prior delete.
Old edit/delete receipts never write over newer or restored state.

Image hashes bind actual upload bytes, MIME and extension, excluding client
basenames and paths. Receipt claims precede image allocation, and a transaction
callback retry reuses the already normalized/stored file. Committed replay never
calls storage. File compensation revalidates live references after transaction
completion; uncertain DB reads preserve files. Interrupted file/DB boundaries can
retain orphans for manual reconciliation, following Phase 7B. They cannot create
a second committed post or delete a known live reference. Receipt snapshots may
refer to subsequently removed images; clients refetch feeds after post edits.

AI send fingerprints prompt, interface language and canonical target language.
It validates a real provider result, then commits the user message, assistant
message and receipt atomically. No fake assistant response is saved on provider
failure. Existing historical half-pairs remain readable and are not fabricated
into complete pairs. Provider calls have a 35-second bound. A generated response
is reused across callback retries within the request. If the entire transaction
aborts, another request may need another provider call; it still persists exactly
one pair. Completed receipts never call the provider again, including after clear.

Each owner/canonical language has a persistent chat barrier. Both send and clear
write it in their transactions, giving their commits a total order. Clear deletes
only that owner's language (including its historical language aliases). A send
committed before clear is removed; one committed after clear is retained. Replay
of either operation does not write the barrier or history. In particular a lost
clear acknowledgement followed by a new send and a late clear retry preserves
the new pair. Clear acknowledgements reconcile current history in both clients.
Client clear intents capture the send they supersede, preserving any later
send's retry key when an older clear is acknowledged. Web connectivity changes
retain unresolved keys. Both clients merge send receipts by durable message ID
after history reload, preventing duplicate displayed pairs.

Safe error contracts: `IDEMPOTENCY_CONFLICT` and `STALE_RESOURCE_REVISION` are
409; invalid keys/revisions are 400; `PROVIDER_UNAVAILABLE` and
`RETRYABLE_SERVER_FAILURE` are retryable 503. JWT 401 behavior is unchanged.
Provider bodies, keys and stacks are not exposed. Transactions require a MongoDB
replica set; tests use disposable replica sets and mocked providers exclusively.

| Record / operation type | Cleanup policy | Reason |
|---|---|---|
| `community-create` | NEVER_EXPIRE | Deleted post/image state cannot prove create was consumed |
| `community-update` | NEVER_EXPIRE | Old edits must not overwrite later revisions |
| `community-delete` | NEVER_EXPIRE | Absence/restoration cannot prove prior owner/key completion |
| `community-reaction` | NEVER_EXPIRE | Old liked state must not undo later opposite intent |
| `ai-send` | NEVER_EXPIRE | Cleared history cannot prove a send/provider result was consumed |
| `ai-clear` | NEVER_EXPIRE | Late retry must not erase later pairs |
| Chat barrier (serialization state) | UNSAFE_TO_CLEAN_AUTOMATICALLY | Concurrent mutations must keep sharing the same write barrier |

There are no TTL indexes, automatic cleanup jobs, replay-age limits or production
backfills. Receipt/result storage grows intentionally; capacity planning remains
necessary. All earlier flashcard/progress receipt policies remain in force.
