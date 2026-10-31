# Phase 11B-C2: shared community objects and recovery

This is a disposable, single-node storage baseline for review. One backend remains configured in Compose. Separate temporary readers exercise sharing; they do not authorize horizontal scaling or establish application-wide multi-instance safety. C2 does not implement 11B-D, production provisioning, real-data migration, zero-loss recovery, or unconditional restore safety.

## Existing contract and inventory

Before implementation, the C1 checkpoint was clean and matched `101924b518a8edf55a031d53f0e493fbda28f6fb`. The complete pre-change reference inventory is in `.release-validation/11bc2/INVENTORY.md` and `existing-upload-reference-inventory.json`: 45 files / 171 locations, generated from Git's full tracked/unignored inventory.

| Surface | Existing contract retained / C2 change |
|---|---|
| CommunityController POST/PUT/DELETE `/community/posts` | JWT/account and owner-scoped mutation checks, operation IDs and resource revisions unchanged; bounded memory Multer interceptors unchanged |
| CommunityService create/update/delete | Original immutable admission still spans preparation, fenced transaction and cleanup; shared deletes add an independent durable intent before the metadata transaction commits |
| CommunityPost / MutationReceipt | Existing `imageUrl` and response JSON retained; receipt replay still returns the original result and image reference |
| CommunityImageStorage | Existing magic/MIME/extension checks, safe sharp decoding/re-encoding, single raster, 5 MiB and 16M-pixel bounds retained; explicit filesystem compatibility and shared S3 branches |
| Existing local image serving | Filesystem compatibility keeps guarded static serving, inode/containment checks and historical raster names; shared mode registers no static handler or disk fallback |
| Shared image serving | Same GET/HEAD URL, now JWT-authenticated and backend-mediated; only an exact live Mongo community reference is visible |
| Clients | React fetches a bounded authenticated blob; Flutter adds the account bearer only on the configured API image route. No S3 URL, bucket credential or presigned URL reaches clients |
| ReadinessService / readiness-probes | S3 mode checks private identity, enabled versioning, independent binding and a current-generation reconciliation receipt; no local writable probe or disk availability dependency |
| MutationTimeline / TimelineWriteGate | Phase 10 Mongo session/singleton/precommit checks and C1 fresh authority checks remain; remote effects reuse nonexpiring C1 permits |
| durable-control / authority-preflight | Explicit open/reconcile checks shared storage; closed verification makes no object/file mutations |
| Compose / manifests / validators | Private object services, separate volumes and credentials, nonsecret object contract and strict readiness evidence |
| Tests | Existing image hardening, ownership, receipt, readiness, restore and authority suites remain; C2 adds adapter, authenticated route, client and real-store failure-boundary coverage |

Legacy presentation documents describe the historical filesystem implementation; they are not the production-like C2 configuration contract.

## Provider, pin and network boundary

The disposable implementation uses **SeaweedFS 4.51**, pinned to `chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8`. The project publishes its [release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.51) and [Apache-2.0 license](https://github.com/seaweedfs/seaweedfs/blob/4.51/LICENSE). It runs as a separate unmodified service, not an embedded library or redistributed binary. Preserve upstream notices if distributing images. No commercial/provider support, license approval for a future distribution, HA or power-loss guarantee is implied.

MinIO was evaluated: its upstream repository is archived and the evaluated pinned image could not be retrieved from the registry. SeaweedFS was selected for this disposable exercise. A different production S3 provider requires its own compatibility/security review.

SeaweedFS's filer/master/volume APIs are privileged independently of S3 authentication. Therefore `object-data` joins **only** the internal `object-control` network. Backend/tools join `objects`, never `object-control`. An S3-only Caddy `object-store` proxy bridges those networks with one fixed upstream `object-data:8333`; it exposes no management route. No object service publishes any host port. Ingress/web cannot join either object network. Admin UI, WebDAV, Iceberg/Lance listeners, embedded IAM API and telemetry are disabled. The local store's metadata and bytes persist together under the independent `object-data` volume. `object-config` is a separate protected secret configuration volume. Neither is Mongo's or PostgreSQL's volume.

The four object administrator/application credential values are distinct synthetic random 64-character hex strings. The one-shot configuration initializer requires an explicit disposable acknowledgement, refuses changed retained credential configuration, and never deletes/reset data. It sets only the fixed volume directory ownership required by UID 10001. A separate explicit bootstrap creates the private bucket, checks one bounded version-inventory page, enables versioning, conditionally creates the identity marker, verifies exact identity and binds the never-initialized independent authority. It refuses any initialized authority, retained image versions/deletion markers, multiple identity versions or truncated/unknown inventory; one exact identity marker permits interrupted empty initialization to resume. Ordinary backend startup never performs bootstrap or migration.

`c2-community-runtime` has exact-prefix GetObject/GetObjectVersion/PutObject/DeleteObject, read-only access to `control/identity.json`, and GetBucketVersioning. It has no list, unrelated bucket/prefix, identity-write, bucket-control, IAM/STS or DeleteObjectVersion capability. Ordinary deletion creates a marker; retained versions remain recoverable. No lifecycle expiry or automated purge is configured. Administrators remain trusted and can defeat retention. Record actual role tests rather than inferring permissions from the policy text.

## Configuration and storage interface

`UPLOAD_STORAGE_BACKEND=FILESYSTEM` retains local compatibility. `DEPLOYMENT_PROFILE=DURABLE_REQUIRED` requires explicit `S3`; S3 also requires durable authority. Missing storage/credentials, identity disagreement or outage fails closed without disk fallback. `UPLOAD_MIGRATION_STATE` must be `NEW_EMPTY` or `VERIFIED_COPY`; these are reviewed deployment decisions, not commands that migrate data.

Inject `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_NAMESPACE`, `OBJECT_STORAGE_IDENTITY`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, plus nonsecret `OBJECT_STORAGE_ROLE`. Outside the fixed disposable `http://object-store:8333` target, HTTPS with normal certificate validation is required. Runtime gets only application keys. Bootstrap/admin keys belong exclusively to the one-shot operator configuration/bootstrap services.

The narrow `ObjectStorage` contract offers immutable create, bounded read, version-bound head, idempotent logical delete, availability and identity verification. The S3 adapter implements a bounded REST/SigV4 subset using native Node HTTP(S): one attempt, no redirect, no implicit provider credential chain, no unbounded listing, eight active requests, fixed query/response limits and deadlines. It supports only single PUT uploads; no multipart worker/retry queue exists. Responses are buffered only up to the existing 5 MiB cap. The existing filesystem compatibility implementation retains its stronger path/inode checks and C1 permit wrapper.

Keys are server-generated:

`community/<environment>/<creation-timeline-UUID>/<creation-generation>/<object-UUID>.<validated-extension>`

No client filename or personal owner ID becomes an object key. A private owner hash binds deletion intents. Public image URLs remain `/uploads/community/<UUID>.<extension>`; the independent ledger resolves the private key/version/checksum. Bounded metadata records UUID, environment/bucket/namespace/storage identity, creation and verified timeline/generation, size/MIME/SHA-256/version, status and durable permit/operation identifiers. Historical post filenames stay valid in filesystem mode; importing them to S3 requires reviewed migration, not implicit fallback.

## Create and visibility state machine

1. JWT/account and operation/resource ownership checks precede mutations. Validate/re-encode the raster with the unchanged image hardening.
2. Preserve immutable admission A. Verify current Mongo/authority and shared identity; obtain a durable C1 permit before remote mutation.
3. Append an independent PostgreSQL `PENDING` object row with a fresh UUID, exact key, owner hash, checksum and create-permit ID. This exists before S3 PUT and survives Mongo rollback.
4. PUT with `If-None-Match: *`; never overwrite a known key. Record the acknowledged version as `STORED`. C1 holds its permit through the remote response and ledger acknowledgement.
5. Commit the existing timeline-fenced Mongo metadata and immutable receipt. A fresh postcommit check records `LINKED` when possible.
6. Visibility is a backend decision: valid JWT, current-generation verified ledger row, exact current Mongo reference, matching stored metadata/checksum, and safe decoded raster. A `STORED` row may already have committed Mongo metadata after a crash; the same checks allow its exact version. There is no public/pending S3 URL or non-atomic object-copy promotion.

Same-operation receipt replay allocates no new object after a completed replay. Concurrent/precommit attempts may leave extra `STORED` objects; these remain independent audit candidates, never silently deleted. If Mongo fails after upload, preserve the object and ledger for explicit review. Mere metadata absence is not deletion authority.

Any ambiguous remote write or missing completion acknowledgement leaves the nonexpiring C1 permit active and closes its owning connection. New required authorization fails closed on the orphan; completed CLOSE/maintenance/advance cannot pass it. Do not settle a permit merely because the HTTP client timed out.

## Delete and explicit retry

Inside the owner-validated metadata transaction callback, persist `DELETE_PENDING` in the independent ledger, with the original operation UUID, before deleting/replacing Mongo metadata. The PostgreSQL write and Mongo transaction are not atomic. If Mongo aborts, its live reference prevents object deletion; the intent remains inspectable. The ordinary cleanup path rechecks all current references, requires the established intent and original verified timeline/generation, registers a C1 permit, records `DELETE_DISPATCHED` and its permit, checks authority again, and issues the logical S3 deletion. Only an acknowledged delete plus durable `DELETED` event completes it.

A store outage after Mongo commit leaves the durable intent. A lost delete acknowledgement leaves the intent and C1 permit; the original version is retained. Duplicate receipt/deletion completion is idempotent. No runtime path deletes object versions or cleans arbitrary names supplied by callers.

An aborted Mongo transaction can leave a durable deletion intent while its live reference remains. A later owner-authorized transaction may reauthorize that intent with its own operation ID only when no active dispatch owns it; the change appends history. Deletion dispatch is claimed atomically in PostgreSQL by exactly one live C1 permit. Concurrent retries leave that owner alone, and completion must match the claim. A dead/uncertain owner cannot be replaced until the existing C1 isolation and effect-resolution procedure settles it. The explicit retry tool reports completion only after reading the durable DELETED state.

There is no automatic background reconciliation. For a settled same-timeline intent, an operator may run `object-effects-cli --plan <public-plan.json>` with an exact public name, original operation ID, timeline and generation, explicit disposable operator intent and OPEN authorization. It processes one established deletion only, refuses a stale/newly assigned generation and preserves versions. It cannot clean upload orphans. Required closure/outage prevents replay.

## Interrupted-effect isolation and A-to-B recovery

Keep admission CLOSED. Stop every backend/tooling/legacy writer and freeze deployments/restarts. For an ambiguous remote request, stop/restart the isolated object-data and S3 proxy processes **after** the recorded pending effect, preserving both volumes; connection loss alone does not prove server-side work stopped. The host `verify-file-isolation.cjs --project language-coach-c2-validation` checks the exact private topology, stopped/no-restart writers, Mongo operations/transactions, PostgreSQL sessions and storage identities. It detects shared storage from the actual container topology/configuration, including the default `language-coach-11b-local` project. C2 administrator receipt issuance additionally requires object-data and proxy start timestamps newer than the pending effects. This is a privileged local snapshot, not a global orchestrator lock.

After inspecting the exact key/version/checksum and reconciling bytes, an administrator may issue the existing bound isolation receipt and the ordinary operator may perform C1 `resolve-effect`. No reference string alone clears an uncertain permit. Unknown `PENDING` uploads stay unpublished/preserved for operator review; do not invent successful Mongo receipts or automatically delete them.

Follow C1 CLOSE/barrier/maintenance/allocation/seal/install ordering. After restoration, A ledger records do not automatically authorize B effects or reads. Run `object-reconcile-cli --plan <public-plan.json>` while B Mongo is CLOSED and authority CLOSED/MAINTENANCE under hard isolation. The plan specifies exact revision/timeline/generation plus public isolation, history-continuity and recovery references. The tool checks at most 500 current image references, reads exact retained object versions, verifies counts/checksums/identities, rechecks the Mongo barrier, and commits adoption plus an append-only reconciliation receipt in one PostgreSQL transaction. Missing/corrupt/legacy references or excessive inventory stop the command; no partial adoption is published. Larger deployments need a separately reviewed paginated inventory workflow.

Adopting a live restored reference records B as its verified generation, clears any old deletion intent, and appends history. It does not rewrite the creation key or delete retained versions. Unreferenced A records remain A, are reported/retained, and cannot be replayed into B. An object absent from restored Mongo is never automatically an orphan safe to delete. Receipt-result URLs and older inventory versions also require incident review. Only after explicit reconciliation may the normal C1 reconcile/open protocol proceed. The current-generation receipt is an admission prerequisite, not a promise that future metadata/object faults are impossible.

## Legacy migration and coordinated backups

No real migration is implemented or performed. Keep existing filesystem mode until an isolated migration has: inventoried current post and retained receipt references plus historical/orphan candidates; validated root containment and actual raster bytes; copied objects and original URL mappings with owner/provenance/checksums; verified every source/destination byte count and checksum plus complete reference coverage; recorded independent ledger/version mappings; tested authenticated reads through another process; preserved an immutable inventory and rollback copy; and obtained explicit security/storage approval. Only then select `VERIFIED_COPY` and switch reads. Never remove original files automatically. The new-empty bootstrap cannot be repurposed as an existing-deployment migration.

Choose an approved quiescent recovery point: stop admissions, finish both Mongo and remote-effect barriers, isolate all writers, capture a consistent whole Mongo database/receipt snapshot, a version-aware object inventory with exact keys/versions/SHA-256/size, and independent PostgreSQL object/issuance/audit/effect history. Back up control history separately from Mongo; verify its acknowledged high-water history against separately controlled retained evidence before authority recovery. A coherent old PostgreSQL snapshot can otherwise forget UUIDs, object versions and effects. Do not restore PostgreSQL to agree with an older Mongo snapshot.

Retain prior object versions and deletion effects for the approved backup/replay retention period. No automatic expiry/purge policy is introduced. Quiescence/snapshot timing, acknowledged post-point data loss, current metadata with missing versions, pending uploads, incomplete deletion intents, historical receipt references, encryption/backup ownership, off-host retention, RPO/RTO and actual restore verification all require an operator-approved recovery plan. A restored Mongo snapshot is not automatically consistent with object storage. No zero-loss or HA claim is made.

## Disposable commands and verification

Use an ignored env file with fresh synthetic secrets and explicit acknowledgements. Preserve every retained volume. For a new empty target, build images, start only the stores, then run bootstrap explicitly:

```sh
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local --profile tools build
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local up -d authority mongo mongo-init object-config object-data object-store
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local --profile tools run --rm object-bootstrap
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local --profile tools run --rm backend-tools node deployment/staging/bootstrap-indexes.cjs
```

Next use C1's explicit authority initialization plan, which leaves CLOSED. A first object-reconciliation plan is public JSON; substitute the **observed** revision/timeline/generation and actual reviewed evidence references rather than generating defaults:

```json
{"expectedRevision":1,"timelineId":"44444444-4444-4444-8444-444444444444","generation":1,"reference":"local-c2-empty-inventory","isolationReference":"verified-stopped-local-writers","historyContinuityReference":"reviewed-independent-local-history"}
```

Mount that plan read-only and run:

```sh
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local --profile tools run --rm -v /absolute/public-reconciliation.json:/plans/reconcile.json:ro backend-tools node lingua_ai_backend/dist/src/tooling/object-reconcile-cli.js --plan /plans/reconcile.json
```

Use the separately reviewed C1 OPEN plan only after this verification. Bootstrap acknowledgements are not a reusable repair switch. A retained environment cannot pass the new-empty bootstrap by clearing one flag or regenerating a timeline.

The explicit real-store suite is `src/community/object-storage.integration.ts`, excluded from runtime packaging and from default `*.spec.ts`. Build a disposable test image using `Dockerfile.backend --target build`, then run Jest with `--runInBand --testRegex object-storage.integration.ts` in `/src/lingua_ai_backend` on the project's `control`, `database` and `objects` networks. The ignored test env needs the existing synthetic `C1_TEST_ADMIN_URL`, `C1_TEST_READER_PASSWORD`, `C1_TEST_OPERATOR_PASSWORD`, `C1_TEST_MONGO_URI`, all application `OBJECT_STORAGE_*` fields, and separate synthetic `STAGING_OBJECT_ADMIN_ACCESS_KEY`/`STAGING_OBJECT_ADMIN_SECRET_KEY` for privileged negative-control fixtures. Targets must be the fixed disposable service DNS/database/bucket. The suite creates only uniquely named synthetic Mongo/PostgreSQL databases and server-generated test object keys; it is not a production migration/restore utility. Run the complete suite, not a selected regex/name subset counted as a full pass. Keep those administrator credentials out of runtime/backend/client artifacts.

Also run the C1 authority/file-effect suites with their required external outage orchestration, all repository quality components, strict static manifests and separate live preflight. Real cross-process/restart/outage/crash/archive-restore observations and exact unique test totals belong in the local C2 report. Neither a local provider fixture nor those observations prove distributed HA, every external writer, authority-history freshness, or production recovery.

## Preserved security limitations

```text
AUTHORITY ANTI-ROLLBACK GUARANTEE: CONDITIONAL
ALL RESTORED-STATE WRITERS ACCOUNTED FOR: NO
END-TO-END FAILURE-CLOSED AUTHORIZATION: PARTIAL
STALE-WRITER FENCING: PARTIAL
EXTERNAL HISTORY CONTINUITY VERIFIED: NO
EXTERNAL WRITER ISOLATION VERIFIED: NO
FULL MULTI-INSTANCE APPLICATION SAFETY PROVEN: NO
REAL STAGING INFRASTRUCTURE READY: NO
PUBLIC/STORE RELEASE AUTHORIZED: NO
HISTORICAL MONGO CREDENTIAL ROTATION VERIFIED: NO
OLD CREDENTIAL REVOCATION VERIFIED: NO
PRODUCTION TRAFFIC AUTHORIZED: NO
```

The existing Multer advisory remains conditionally unreachable under the unchanged synchronous default filters. No async file-filter callback, adapter upgrade or blind dependency upgrade is part of C2. Retest if interception changes. Local object sharing and synthetic failure tests do not clear global history/isolation, external credentials, rate-limit coordination, production migration, HA, retention or restore-drill requirements. C2 acceptance remains pending review.
