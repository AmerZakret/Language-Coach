# LinguaAI Backend API

A clean NestJS backend for the LinguaAI English learning application.

## Getting Started

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

Community images use `UPLOAD_ROOT` (absolute or relative to the backend working
directory), defaulting to `<backend working directory>/uploads`. Writing,
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
