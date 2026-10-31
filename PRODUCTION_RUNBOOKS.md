# Production deployment and recovery runbooks

Phase 11B-C2 adds [versioned private object storage and explicit object/Mongo reconciliation](COMMUNITY_OBJECT_STORAGE.md). For S3 deployments, use that coordinated object inventory/version boundary and C1 independent history, rather than assuming a restored Mongo snapshot matches current uploads. Historical local filesystem procedures remain applicable to compatibility deployments.

For Phase 11B-C1 required-mode deployments, the
[independent-authority procedure](INDEPENDENT_TIMELINE_AUTHORITY.md) extends the
Phase 10 Mongo fence with separate PostgreSQL control, ledger and crash recovery.
Older injected-control instructions below are legacy history, not a replacement
for the required close/barrier/maintenance ordering. No real restore is executed.

Phase 8F operator procedures; no production deployment, rotation, backup, migration
or restore has been performed by these documents or the local preflight. Assign a
release owner, database/storage owner, security owner and incident commander before
use. Record evidence in restricted deployment records, never secret values in Git.
Use [configuration contracts](PRODUCTION_CONFIGURATION.md) and the
[pronunciation guide](lingua_ai_pronunciation_service/README.md) alongside this guide.

## Supported architecture

| Component | Scaling and state | Deployment requirement |
|---|---|---|
| Web static frontend | Horizontally cacheable immutable assets; personalized queues/auth/caches remain browser-local | HTTPS, SPA routing, compatible bundle, supported Web Locks; HTML must revalidate |
| Flutter clients | Independent devices; owner-scoped durable queue slots, failed actions, mappings and checkpoints are local durable state | Signed release, explicit HTTPS API_URL, capability minimums below |
| NestJS backend | Request/stateless domain processing; limiter buckets, concurrency budgets, counters and fingerprint salt are per-process | All instances use the same Mongo deployment, schema contract and persistent upload root |
| MongoDB | Authoritative users, progress/provenance, resources, receipts, revisions, barriers and history | Transaction-capable replica set or supported sharded cluster; coordinated backups/index provisioning |
| Community upload filesystem | Durable objects referenced by DB and durable replay results | Single instance: persistent mount; multiple instances: same shared mount and URL namespace |
| Private pronunciation service | One loaded model/executor and inference limit per process; temporary spools are ephemeral | Private network, dedicated token, pre-provisioned artifacts/cache; benchmark each device/worker configuration |
| Gemini | External inference/cost dependency; no application receipt authority | Server-side key, explicit enablement, bounded calls/budgets; never expose keys to clients |
| Ingress/reverse proxy | Routing/TLS and optional global abuse limits; no application ownership authority | Explicit trusted proxy IP/CIDR policy, allowed origins, request-size/deadline alignment and health probes |

No backend replica may use its own isolated upload directory in a multi-instance
deployment. Local readiness cannot prove shared storage, durability across host
loss, available capacity or a usable backup. Sticky sessions do not fix divergent
filesystems. Preserve public `/uploads/community/` paths and referenced filenames.
Route uploads through the existing validated serving path; do not publish the entire
mount, model cache or temp directory as a static alias. Preserve the 8C response/
cache protections and apply HTTPS/HSTS at the explicitly configured TLS boundary.
Mongo transactions/unique receipts provide cross-device correctness; process-local
rate/concurrency controls do not provide cluster-wide abuse protection.

## Deployment sequence

Protocol rollout also requires the staged order in
[Release identity and client compatibility](RELEASE_COMPATIBILITY.md): explicitly
configure `ALLOW_LEGACY` for backend-first support, release compatible clients,
reconcile/drain legacy queued work, then deliberately enable `ENFORCE_MUTATIONS`.
Serve the matching web `/release.json` with no-cache/revalidation semantics.
An enforcement/policy or artifact rollback must preserve receipt/epoch/barrier and
queue contracts; prefer a compatible forward fix. This does not relax credential
rotation before traffic.

1. **Credential rotation before production traffic:** complete the rotation and
   revocation procedure below for the historical Mongo credential. Do not treat a
   configuration pass or a code change as evidence that rotation occurred.
2. Provision transaction-capable MongoDB and restricted application/migration/audit
   identities. Verify actual server support in staging; a URI parameter alone is
   insufficient. Confirm sharding/unique-index compatibility if using mongos.
3. Take a recoverable pre-migration backup and record the recovery boundary. Run
   bounded duplicate/ownership/provenance preflight on a restored copy first.
4. Review and execute an operator-controlled collection/catalog/index migration;
   verify exact critical options using the inventory below. Production boot will
   neither seed lessons nor repair indexes. Never use development mode as migration.
5. Provision the persistent/shared upload mount, permissions, backup snapshot and
   stable URL routing. Preserve historical images and verify all replicas see the
   same objects. Assign free-space monitoring and restore ownership.
6. Stage pronunciation model artifacts/cache, dedicated token, private network and
   resource limits. Do not switch a shared service to authentication-only while old
   backend callers remain. A new isolated endpoint may be staged ahead of cutover.
7. Build/review all release artifacts and inject production configuration through
   the secret store. Run the local preflight and four-component release checklist.
8. Deploy the token-capable backend without broad ingress traffic. Keep application
   readiness gating enabled; a listening socket or `/health/live` is insufficient.
   Roll consumers with the new token before enforcing it on an existing shared
   pronunciation endpoint, as required by 8E. Do not mix incompatible backend writers.
9. Activate the authenticated pronunciation service; verify its readiness and the
   backend's independent readiness. Backend core readiness does not call Gemini or
   Whisper. Check both feature flags against intended rollout policy.
10. Deploy the compatible web bundle, revalidating HTML and retaining immutable
    asset URLs needed by active clients. Execute the old-tab policy below.
11. Release signed Flutter clients with the capability minimums below. Assign actual
    release-version/build-to-capability mapping; source capability is not proof that
    installed devices are upgraded. Gate unsupported old writers at deployment.
12. Run smoke tests using dedicated test accounts/data, then a controlled canary.
    Watch readiness, 5xx/429, dependency failures, replay conflicts and storage growth.
13. Obtain operator sign-off on migration, credential revocation, backup restore
    drill, compatibility and canary evidence. Only then enable broader traffic.

An initial deployment without existing consumers may start the private authenticated
service before backend startup. For an in-place rollout, preserve the consumer-first
credential cutover rule. A deployment fails closed if any required gate is unresolved.

## Credential rotation, revocation and history cleanup

**ROTATION** installs a replacement. **REVOCATION** makes the exposed credential
unusable. **HISTORY CLEANUP** reduces future discovery but does not revoke secrets.
Rotation/revocation comes first; no automatic Git history rewrite is authorized.

1. Security/database owner creates a separate least-privilege replacement through
   the trusted provider/operator console. Do not reuse the exposed password locally,
   in test environments, backup jobs, audit clients or deployment agents.
2. Update the deployment secret store and authorized local environment without
   copying values into shell arguments, reports, tickets, docs or logs. Inventory
   every consumer, including scheduled/admin consumers outside this repository.
3. Deploy/restart consumers with the replacement under controlled traffic. Verify
   replacement authentication and required application permissions through an
   explicitly authorized operator workflow; record success and secret version ID,
   not the URI/password. The repository preflight makes no authentication attempt.
4. Revoke the old identity/password and terminate old connections where supported;
   password rotation alone may not end existing authenticated sessions. Verify the
   old credential can no longer establish access using a secure authorized check.
   Do not paste it into a command line or enable diagnostic credential logging.
5. If replacement access or revocation fails, contain access and keep broad traffic
   closed. Do not silently fall back to the exposed credential.
6. Review database/network/audit logs when available, exposure interval and affected
   privileges. Rotate other credentials if the exposure scope is uncertain. Record
   incident disposition and revocation evidence with restricted access.
7. Coordinate JWT_SECRET rotation separately: existing tokens become invalid; there
   is no multi-key grace/revocation service here. Rotate the pronunciation token in
   both consumers together without an anonymous production fallback.

**CREDENTIAL ROTATION VERIFIED BY CODE: NO. OPERATOR ACTION REQUIRED: YES.**
Restoring backups must never restore compromised credentials or undo revocations.

## Controlled database and index migration

Use a dedicated operator-approved migration identity. Application startup is
VERIFY ONLY with production autoIndex/autoCreate, receipt initialization, legacy
index removal and lesson seeding disabled. Do not toggle NODE_ENV to bypass this.
Read-only preflight never creates indexes; production readiness only verifies them.

The executable authority is
[`index-inventory.ts`](lingua_ai_backend/src/operations/index-inventory.ts).
All keys below are **CORRECTNESS_CRITICAL**, ordered as shown, with `unique:true`,
no sparse/partial filtering, no expiry and simple/binary collation. Equivalent index
names are allowed. Performance-only indexes in the same inventory are not gates.

| Collection | Ordered unique key |
|---|---|
| users | `email` |
| lessons | `id` |
| progresses | `userId, lessonId` |
| flashcards | `userId, targetLanguage, targetWord` |
| flashcardoperations | `userId, operationId, operationType` |
| progressresets | `userId, operationId` |
| mutationreceipts | `userId, operationType, operationId` |
| chatbarriers | `userId, targetLanguage` |
| timelinecontrol | `singleton` |

1. Isolate writes from every backend/legacy writer; take and restore-test a backup.
   Inventory collection options, existing indexes, shard keys, catalog and schema
   versions. Use a bounded read-only database identity for diagnostics.
2. For **each ordered key**, group by its exact stored fields and count duplicate
   groups, null/missing key fields and malformed ownership types. Do not infer
   ownership from email or coerce IDs/language aliases merely to satisfy uniqueness.
   On large collections, schedule bounded server-time queries or use a restored
   copy; do not dump private rows into general logs. Count-only example, run manually
   in an already authorized database session:

   ```javascript
   db.getCollection('progresses').aggregate([
     { $group: { _id: { userId: '$userId', lessonId: '$lessonId' }, n: { $sum: 1 } } },
     { $match: { n: { $gt: 1 } } },
     { $count: 'duplicateGroups' }
   ], { maxTimeMS: 5000 })
   ```

   An empty successful result means zero groups, not that missing/type/ownership
   checks passed. A timeout/error is inconclusive and blocks sign-off. Do not run
   an unbounded full-collection scan during peak traffic.
3. Use the existing [progress audit](lingua_ai_backend/src/tooling/README.md) in
   database-read-only mode on a restored copy. It writes a protected local report;
   it is separate from the no-write deployment preflight. Omit `--apply` and
   `--rollback`. Its deterministic repair applies only to evidenced derived levels,
   not duplicate completions, XP reconstruction, ownership or receipt rebuilding.
4. Duplicate/malformed rows require evidence-preserving case review and a separately
   authorized repair plan. Never automatically delete, merge or fabricate user data,
   receipts, awards or assistant text. Fix on a restored copy, then repeat diagnostics.
5. Operator provisions required collections (including communityposts, chatmessages
   and progressauditrepairs when used) and approved lesson catalog from
   `lingua_ai_backend/src/lessons/data`. Verify stable lesson IDs/content; startup
   does not populate a new production database. Do not remap existing references.
6. Operator executes reviewed index changes, one collection at a time. For example,
   **this is a manual migration write, never a preflight command**:

   ```javascript
   db.getCollection('progresses').createIndex(
     { userId: 1, lessonId: 1 },
     { name: 'userId_1_lessonId_1', unique: true, collation: { locale: 'simple' } }
   )
   ```

   Review the actual database target, ordered keys and options for every inventory
   entry before execution. Use the selected Mongo provider/version's approved index
   build procedure. On sharded deployments, ensure required unique keys are compatible
   with shard keys; otherwise redesign the deployment in a separate approved plan.
7. Inspect actual `listIndexes` results, not merely a successful migration exit code.
   Check uniqueness, ordered keys, sparse/partial/collation/expiry options. Install
   the correct language-aware flashcard index before separately reviewing removal
   of legacy unique `{userId,targetWord}`. Never run blanket dropIndexes/syncIndexes.
8. Missing/wrong options, conflicting names or historical duplicates stop the
   migration. Preserve existing data/index evidence and the old constraint until
   a reviewed replacement is verified. Do not leave traffic open while uniqueness
   is absent. After remediation retry the failed reviewed step, not automatic repair.
9. Retain migration evidence and verify bounded transaction/index checks through
   backend readiness. `UNSAFE_TTL`, `LEGACY_INDEX_CONFLICT`, `MISSING_INDEX`,
   `WRONG_INDEX_OPTIONS` and `INDEX_CHECK_FAILED` require operator action. Any
   unexpected expiry on protected collections is an incident; do not merely hide it.

## Backup policy and coordinated boundary

The operator must choose and approve **RPO/RTO**, backup frequency, retention,
recovery owner and verification cadence; no business recovery numbers are invented
here. Use consistent MongoDB backups and point-in-time recovery when supported by
the deployment/provider. A live collection-by-collection dump is not automatically
a consistent snapshot. Verify the chosen backup method on the actual topology.
Encrypt backups in transit/at rest, restrict backup/restore access independently,
protect encryption keys, and retain an off-host failure-domain copy as appropriate.
Run periodic restore drills into isolated infrastructure and measure achieved RPO/RTO.

Back up the **entire application database state together**, including users/guest
identities, progressEpoch and progressWriteRevision, progresses/completion provenance
and stored awards, flashcards/history, flashcardoperations, progressresets,
communityposts, mutationreceipts, chatmessages, chatbarriers, timelinecontrol,
timelinecontrolevents and audit evidence.
Record collection/index options, app artifact/capability manifest and catalog version.
Do not export just resources and omit receipts, or restore just a user's rows without
their owner-scoped safety state.

Back up the persistent **UPLOAD_ROOT**, including community images and preserved
historical raster files, with matching filenames/permissions and a manifest of
object digests. Use storage snapshots/versioning where available. Do not back up
only the application container layer. Reference timestamps alone do not prove
consistency: post updates/deletes can remove files between independent backups.

The simplest coordinated boundary is: disable all writes, drain every writer and
file cleanup, then capture a database-consistent snapshot and upload snapshot while
quiescent; record a common boundary/manifest. If online backups are required, the
storage/database owners must prove a versioned file set corresponding to the DB
recovery point, including deleted/replaced objects. Uncoordinated DB/upload restores
are prohibited. Retain operational secret versions securely, without reviving revoked
credentials. Pronunciation model artifacts are reproducible, separately versioned
deployment inputs; audio/temp spools are ephemeral, not authoritative user history.

### Receipt consistency and offline clients

**Domain state newer than receipts can allow duplicate replay effects. Receipts
newer than domain state can acknowledge effects absent after rollback.** Restore
flashcard receipts, reset receipts/epochs, Community receipts/revisions, AI receipts/
chat barriers/history and completion provenance at the same consistent boundary.
Never reconstruct receipts by guessing from current resource existence. Never reset
epochs/barriers/revisions to zero or fabricate successful message pairs.

Even a coordinated old restore point can lose previously acknowledged operations
after that point. Offline clients may retain old operation IDs, temp-ID mappings,
expected resource revisions and queued resets/completions indefinitely. Restoring
older counters can reuse an epoch/revision value; numerical equality is not proof
that an old intent belongs to the restored timeline. Other clients may have removed
their acknowledged queue entries already. Client caches are not server backup.

Current clients have **no disaster-restore generation fence**. A logout, JWT rotation,
page reload, or new token does not safely discard owner-scoped pending work. Do not
delete Flutter durable slots, failed/quarantined actions, browser queues or mappings,
change operation IDs on retries, assign old work to another account, or assume all
offline devices can be contacted before writes reopen.

Prefer forward recovery/PITR to a boundary preserving acknowledged receipt/domain
history. If acknowledged history is lost or replay safety cannot be demonstrated,
keep affected business writes and queue dispatch unavailable: require an explicit
incident/reconciliation plan and, if necessary, a separately reviewed recovery fence
before reopening. This runbook does not implement that fence. RPO loss acceptance
alone does not establish replay safety. Do not test uncertain intents on live users.

## Consistent restore procedure

1. Incident owner declares scope; stop/disable all writes, offline dispatch ingress,
   background/admin writers and upload cleanup. Remove every backend from readiness
   routing (maintenance at ingress), drain/stop it, and retain incident evidence.
2. Select the coordinated DB/upload restore point and manifest; verify backup access,
   integrity, key availability, artifact compatibility and receipt completeness.
   Preserve the failed current state for investigation; do not overwrite the only copy.
3. Restore MongoDB into an isolated target with transactions supported. Restore the
   **entire application DB**, not selected newer receipts or older resources.
4. Restore the matching upload filesystem version into an isolated persistent root;
   retain exact URL-relative names and manifests. Never point recovery at a running
   instance's shared mount. Use current authorized secrets, not revoked backup values.
5. Verify all critical indexes/options against the inventory, actual transaction
   topology, catalog IDs, storage permissions/containment and replica mount identity.
   Use controlled migration only if required; do not bootstrap via development mode.
6. Check DB image references **and image URLs in retained Community receipt results**
   against the restored file/version manifest. A replay result can retain an image
   URL after normal resource update/deletion; missing objects are not permission to
   invent files or rewrite receipts. Classify expected historical absence separately
   from missing currently referenced images. Report inconsistencies for review.
7. Verify durable receipts/results, owner IDs, hashes, progress epochs/write revisions,
   completion awards/provenance and AI pairs/barriers remain coherent. Run the bounded
   database-read-only progress audit with a protected report; no repair/apply flags.
8. Resolve the offline replay/acknowledged-history gate above. If post-point evidence
   is missing, **STOP before traffic**; record a reviewed reconciliation/recovery plan.
9. Build/validate compatible artifacts and configuration. Start backend behind closed
   ingress; require `/health/ready` 200 and independently check pronunciation readiness.
   `/health/live` alone never authorizes recovery cutover.
10. Use dedicated test accounts for smoke tests and same-key replay checks; verify
    mounted images through more than one replica where applicable. Preserve operation
    IDs and original payloads on retries. Do not mutate restored real-user histories.
11. Re-enable a controlled canary only after incident/security/storage sign-off.
    Monitor replay conflicts, 5xx, readiness, storage and provider failures; broaden
    traffic only after verification. Record measured recovery time and loss boundary.

## Compatibility minimums and downgrade restrictions

These are capability minimums, **not invented semantic version numbers**. Map each
signed/mobile build, immutable web bundle and backend artifact digest to capabilities
in the deployment record. Existing package/app versions alone are not sufficient.

| Component | Minimum supported capability set |
|---|---|
| Backend | JWT sub ownership/unique backend guests; progress epochs/reset receipts; flashcard receipts; 7E Community desired-state/revisions/receipts and AI atomic pairs/clear barriers; 8A-8E production contracts |
| Web | 7A same-owner Web Locks/auth coordination plus 7C owner/session/language guards and 7E stable mutation IDs/desired-state/revision-aware clients; 9C protocol/build/update handling; 9D durable create/send/clear recovery |
| Flutter | Epoch/reset and mutation-ID aware clients; 7C session/cache guards, 7D durable queue migration/retention, 7E Community/AI contracts; 8A release endpoint/signing/permissions; 9C protocol/build gating and 9D durable intent recovery |
| Pronunciation | 8E dedicated-token authentication, bounded audio/inference, offline artifacts and live/ready lifecycle |

Missing mutation keys/revisions/epochs may reject on the new backend; do not remove
validation to support old clients. A new client against a pre-contract backend may
appear to work while replay/ownership/clear semantics are unsafe. Do not mix those
versions or route writes randomly between incompatible backends. An old unprotected
pronunciation service is not a safe rollback target. Roll new token-sending backend
consumers before authentication-only service cutover; keep actual tokens aligned.
Phase 9C CLIENT_PROTOCOL_POLICY explicitly stages ALLOW_LEGACY then
ENFORCE_MUTATIONS. Headerless unkeyed legacy flashcards are accepted only in the
legacy stage and bypass durable receipts; declared current-protocol flashcards
require stable keys in both modes. Enforcement rejects incompatible mutation
writers without blocking auth/read/discovery. Verify the actual cohort before
enabling enforcement; package version alone is not proof of capability.

**Blind downgrade is prohibited. Prefer forward-fix.** Do not downgrade below
epoch/reset, receipt, desired-state/revision, AI barrier or durable-storage contracts.
Older Flutter binaries may ignore migrated slots or retired SharedPreferences state;
do not copy slots back, erase new stores or rerun ambiguous legacy migration. Preserve
both generations, failed/quarantined work and reference mappings. No Web IndexedDB
migration is included. A binary rollback is allowed only after a restored-copy test
proves unchanged wire/storage semantics and operator approval; otherwise contain
traffic and forward-fix. A database rollback follows the restore procedure, never
an automatic deploy rollback or ad-hoc collection rewind.

### Old web tabs

Pre-7A tabs do not participate in Web Locks and can race current tabs' localStorage.
**Close/reload all pre-7A tabs before coordinated writes resume**, including background
windows/PWAs and multiple profiles. A new tab does not upgrade an old running bundle.
Do not clear site data or owner queues as an update mechanism. Unsupported Web Locks
browsers retain the existing fail-closed queue policy; do not bypass it at rollout.

Use a maintenance notice and full reload/close instructions, revalidating index.html,
immutable hashed assets and a deployment-record bundle digest. Managed environments
can require browser restart and client cohort verification before reopening traffic.
Current bundles use Phase 9C build/protocol metadata, release.json checks and
update-required notices. The explicit protocol gate does not retroactively patch
pre-7A tabs or force their reload. Close/reload all pre-7A tabs and verify the
client cohort; do not clear auth, queues or Phase 9D durable-intent journals.
Unsupported old protocols pause saved work without relabeling it. No service-worker
update system is introduced here. See RELEASE_COMPATIBILITY.md and CLIENT_RECOVERY.md.

## Capacity inventory and safe monitoring

| Resource | Growth class | Operator action |
|---|---|---|
| Users/backend guests | UNBOUNDED_PER_OPERATION | Track registrations/guest growth and ingress abuse; no automatic guest deletion |
| Flashcards and embedded review history | UNBOUNDED_PER_OPERATION | Track card counts and per-card BSON/history growth, including document-size headroom |
| flashcardoperations | UNBOUNDED_PER_OPERATION | Track count/data/index bytes and growth; NEVER_EXPIRE safety evidence |
| progresses/completion provenance | BOUNDED_PER_RESOURCE | Bound per owner/lesson key, but fleet/catalog growth is unbounded; retain stored awards/epoch evidence coherently |
| progressresets | UNBOUNDED_PER_OPERATION | Retain reset receipts; track per-interval growth, bytes and replay conflicts |
| communityposts and mutationreceipts | UNBOUNDED_PER_OPERATION | Posts/reaction membership and receipt results grow independently; deleting a post does not authorize receipt cleanup |
| AI mutationreceipts/results | UNBOUNDED_PER_OPERATION | Sends/clears retain results even after history clear; monitor result/data/index growth |
| chatbarriers | BOUNDED_PER_RESOURCE | One owner/language row; fleet growth unbounded, retain ordering evidence |
| chatmessages | UNBOUNDED_PER_OPERATION | Track history count/bytes; user clear does not clear receipts/barriers |
| progressauditrepairs | UNBOUNDED_PER_OPERATION | Retain operator repair/rollback evidence with domain state |
| Upload images | OPERATOR_MANAGED | Track object count/used/free bytes, missing references and orphan candidates |
| Collected logs | OPERATOR_MANAGED | Assign retention/access/capacity independently from durable safety receipts |
| Pronunciation models/cache | OPERATOR_MANAGED | Record artifact size/digest/version, disk and per-worker model memory |
| Pronunciation temp spools | EPHEMERAL | Bound admission/bytes, monitor temp usage and stalled work; hard kill may leave residue |
| Limiter buckets/counters/executors | EPHEMERAL | Per-process only; restart resets counters/budgets, never treat them as receipts |

Operators collect document count, collection/storage/index size and growth rate,
storage headroom, guest creation and AI/Community receipt growth at a cadence chosen
for workload/capacity. Prefer metadata/estimated counts and sampled planning; exact
large counts/aggregations can be expensive and require bounded authorized queries.
Alert before storage/index/cache pressure threatens the operator's chosen headroom;
do not invent universal thresholds. Bound administrative query time and permissions.

**No TTL or automatic cleanup is permitted for safety receipts, barriers or
completion provenance.** Classifications from Phase 7 remain NEVER_EXPIRE or
UNSAFE_TO_CLEAN_AUTOMATICALLY unless a separate proof establishes otherwise. Current
resource deletion/history clear/client inactivity cannot prove no late replay.
Archival is only viable under a separately reviewed design preserving authoritative
unique lookup/replay across hot and archived evidence; an ordinary backup is not an
online dedupe store. No archival/cleanup job is added. Do not prune temp-ID mappings
or failed/quarantined client actions without proven reference/recovery safety.

### Upload reconciliation

Monitor used/free bytes and inodes where relevant, image count, cleanup failure
events and orphan-candidate growth. Back up before review. Generate a **report of
candidates only** from a consistent/quiescent DB/filesystem view: compare validated
root-contained filenames against current post references, retained receipt results,
in-flight staging uncertainty and historical preservation records. Never follow
symlinks outside the root or delete arbitrary paths read from DB/report fields.
Age/unreferenced status alone is not deletion proof. Independently review candidates,
resnapshot/recheck references and authorize any later deletion action separately.
Readiness's temporary writable probe is not a free-space/orphan audit. No production
orphan deletion command or automatic reconciliation is provided.

### Pronunciation capacity

Benchmark model resident/peak memory, CPU/GPU saturation, decode/inference latency,
timeouts/busy responses and concurrency **on the target device**; no benchmark
numbers are asserted. Each ASGI worker multiplies model memory and independent
inference budgets. Start with one process and configured default concurrency one;
do not multiply workers to hide slow native inference. Provision bounded private
temp storage for admitted uploads plus persistent model cache, and container CPU/
memory limits. After HTTP timeout/cancellation, native work retains its slot/spool
until completion. Shutdown has bounded wait but native threads may delay process
exit; orchestration must provide a final hard deadline and inspect temp residue
only after the process is gone. No scoring/phoneme or GPU autoscaling changes here.

## Rate limits and observability operations

Choose and record **A: single backend instance with process-local limits**, or
**B: scaled backend with ingress/global rate limiting**. C is a future shared
limiter store, not present. Current buckets/budgets/counters reset on restart and
are independent per replica; round-robin traffic can multiply effective limits.
Ingress must cover pre-auth login/register/guest creation and guest/IP expensive-
provider abuse across replicas. Configure only actual trusted proxy IPs/CIDRs;
never enable arbitrary forwarded-chain trust. Avoid limiter retries/reset loops
that amplify provider cost. External provider quotas are not application abuse
controls. No Redis/distributed limiter or permanent account lockout is added.

Collect JSON application/service logs centrally with restricted access, retention,
disk/ingestion budgets and alert ownership, without selecting a vendor. Proxy logs
must also omit authorization/service headers, cookies, request bodies, audio,
prompts, query secrets and full provider responses. Request IDs correlate requests;
salted owner/operation fingerprints and counters are process-local, not billing
records or durable identities. Preserve IDs through authorized proxy forwarding.

Alert on `readiness.transition`, `readiness.check_failed`, `readiness.diagnostic`,
HTTP 5xx/429 spikes, `provider.failed` (including PROVIDER_TIMEOUT),
`provider.configuration`, `rate_limit.rejected`, `concurrency.rejected`,
`transaction.failed`, `transaction.retry`, `receipt.conflict`, `progress.epoch_conflict`,
`upload.cleanup_failed`, `upload.storage_unavailable`, `shutdown.drain_timeout` and
`shutdown.watchdog`. Pronunciation `model.unavailable`, `inference.rejected`
(INFERENCE_TIMEOUT or SERVICE_BUSY category) and `temp.cleanup_failed` require
corresponding owners. Investigate rates/baselines; do not log full stored receipts or raw user text
to diagnose conflicts. Health completion logs are intentionally reduced; readiness
and provider diagnostics are distinct from liveness. No public metrics endpoint or
external monitoring integration exists.

## Release artifact checklist

Record operator, reviewed commit/artifact digests, capability mapping and checklist
evidence; use clean builds in the intended target runtime. Commands below are local
checks except explicitly identified deployment health/smoke checks. Inject secrets
out of band; never copy deployment `.env` values into this repository.

### Backend release

- [ ] Target-platform `npm ci` and `npm run build` succeed, including Sharp native
  runtime compatibility. Test-only mongodb-memory-server stays a dev dependency.
- [ ] `npm run validate:prod` and `npm run preflight:deploy` pass with injected
  NODE_ENV=production; dist/src/main.js exists and start:prod uses the validated launcher.
- [ ] Exact artifact digest matches reviewed capabilities; config flags, explicit
  origins, trusted proxy policy, persistent root and non-reused secrets are approved.
- [ ] Database/index/catalog and upload shared-mount evidence is complete.
- [ ] Deployment `/health/live` and `/health/ready` pass; ingress uses readiness,
  startup allowance and termination grace above SHUTDOWN_GRACE_MS/routing drain.

### Web release

- [ ] Inject explicit public HTTPS VITE_API_URL (self-hosted exception only by
  reviewed policy), then `npm run build`; no production localhost fallback.
- [ ] Inspect release artifact/configuration record for the intended API origin;
  run `node --test test/production-config.test.cjs` before packaging. VITE values
  are public; no service/provider credentials in bundle or source maps.
- [ ] Serve HTTPS/SPA fallback, revalidate HTML, retain compatible immutable assets;
  record bundle digest and execute old-tab reload/cohort policy. Web Locks required
  for coordinated queued writes; validate release.json/build/protocol metadata and
  retain Phase 9D owner-scoped intent journals. Public source maps are disabled.

### Flutter release

- [ ] Supply explicit public HTTPS `--dart-define=API_URL=...`; run release-config
  tests and `flutter analyze`. Verify intended endpoint in the produced release.
- [ ] Configure private Android/iOS signing/provisioning outside Git, final app IDs
  and platform distribution metadata; no debug-signing fallback.
- [ ] Verify Android INTERNET permission and iOS microphone purpose, recording on
  target devices and backend-only pronunciation. No service credential in clients.
- [ ] Map signed build to epoch/operation-ID/session/durable-queue capabilities;
  exercise upgrade migration with preserved owner-scoped work on test devices.

### Pronunciation release

- [ ] Install pinned requirements in target Python/native runtime; `python -B -m pip
  check` and `python -B config.py --production` pass without model load/download.
- [ ] Provision immutable model/cache artifact and recorded digest, explicit private
  binding and matching dedicated token. No production download or insecure override.
- [ ] Use `python -B main.py` production launcher, one worker initially, measured
  resource limits and final process kill deadline; no development auto-reload.
- [ ] Independent `/health/live` and `/health/ready` pass after model load; wrong/missing
  service token cannot invoke inference. Test via backend using bounded synthetic audio.

### Local deployment preflight

From lingua_ai_backend after building: `npm run preflight:deploy`.
`npm run preflight:deploy -- --help` shows
scope without configuration. The tool reads compiled configuration/entry metadata,
launcher command, critical-index inventory and required runbook files only. It
ignores `.env`, has no DB/HTTP/provider calls, child processes, file writes, index
creation or apply/repair/connect flags. Output is a safe local status summary.
It never starts Nest, calls runtime readiness/storage probes or downloads Whisper.
Run it from the reviewed release checkout with the referenced runbooks packaged
beside the backend; a backend-only runtime image need not ship or invoke this tool.

A pass is **LOCAL_PREFLIGHT_PASSED**, not production-ready or rotation-verified.
Web/Flutter artifact values, Python configuration/artifacts, credential revocation,
topology/index existence, shared storage, backup consistency and compatibility are
explicit operator-pending checks. Run the separate component checks in their own
environment: do not pass the backend's full environment (including CORS_ORIGINS)
into the internal Python service. No live DB preflight mode is implemented.

## Post-deploy smoke tests

Use dedicated test accounts, unique test content and a preapproved test-data budget
in a canary/staging cohort. Do not use production user accounts. These are deliberate
application writes/provider calls by operators, **not** actions of local preflight.
Keep tokens/private fields out of test reports; retain operation IDs privately for
same-payload retries. Do not change the payload or regenerate a key after uncertain ack.

| Flow | Verification |
|---|---|
| Health | Backend and pronunciation live/ready separately; no provider inference in health |
| Register/login | New dedicated account can authenticate; wrong credentials safe; no account dump |
| Backend guest | Two new guest sessions get distinct authoritative owners; local_guest stays tokenless/backend-isolated |
| Lesson progress | Fetch current progressEpoch, complete a known catalog lesson with that epoch, replay and confirm XP/provenance once |
| Flashcard | Create/review/update/delete with stable per-action X-Idempotency-Key; same-key same-payload replay never doubles mutation/history |
| Community | Create text/image post with key, replay same logical content/image; like liked=true twice, unlike false twice; authoritative membership/count once; delete with expected revision and replay |
| AI chat | Same-key same-language/context send replay returns one durable pair without another provider call; changed payload conflicts; use a fresh key for a new send |
| AI clear | Clear language with key, send afterward, replay the old clear; later send remains and another language is untouched |
| Pronunciation | Bounded valid audio through backend /pronunciation/assess; response/scoring shape preserved; service token absent from clients/logs |
| Session switch | Logout A/login B while an A request is delayed; A ack cannot mutate B UI/cache/queue; return to A preserves A work |

Community edit includes expectedRevision in the mutation body; delete uses
X-Resource-Revision. Fetch current authoritative revision before a new intentional
write. For replay, retain the original key/payload/revision even after newer changes;
do not apply returned historical results as blind local deltas. Do not delete retained
receipts as smoke-test cleanup; dedicated domain cleanup still uses normal contracts.

## Incident response basics

Use **contain -> diagnose -> restore -> verify**. Preserve evidence first; avoid
restarts, database rewinds or cleanup that destroy replay/ownership evidence.

| Incident | Contain and diagnose | Recover and verify |
|---|---|---|
| DB unavailable | Readiness removes routing; liveness may stay up; examine safe connection/topology events | Restore authorized connectivity/topology, wait for bounded readiness recovery, then canary; no repeated liveness restarts for dependency outage |
| Critical index missing/wrong | Keep business traffic unavailable; inspect inventory and bounded safe diagnostics | Operator migration after backup/duplicate review; no auto-create or data deletion; verify readiness |
| Upload storage unavailable | Keep affected instances unready; check mount identity/permissions/free space and cleanup events | Restore shared persistent root and matching DB references; no temporary empty replacement root; verify each replica |
| Gemini outage/quota | Core readiness may remain ready; contain provider-cost traffic and inspect safe codes/counters | Correct quota/config or wait; bounded retries only; committed replay bypasses provider; verify test account without logging prompts |
| Pronunciation unavailable | Diagnose independent readiness, token/config, artifacts, capacity and timeout categories; no anonymous fallback | Correct dedicated token/private endpoint/model resources; verify service and backend route separately |
| Credential exposure | Restrict access/traffic, preserve audit evidence, rotate/revoke via security owner | Verify replacement and revocation, audit scope, never restore exposed credentials; history cleanup separate |
| Excessive 429/provider abuse | Inspect safe policy/scope and ingress fleet limits; protect guest creation/IP budget | Adjust reviewed ingress/capacity policy, do not disable limits/restart to reset budgets; verify normal canary usage |
| Storage nearly full | Restrict writes/provider activity as appropriate; protect DB/upload/log/temp durability | Add approved capacity, adjust operational log retention; report orphan candidates only; never expire receipts to free space |
| Failed deployment | Close canary/broad routing, retain compatible artifacts/config and evidence | Forward-fix preferred; binary rollback only with proven capability compatibility; data rollback uses coordinated restore and offline replay gate |

No backup scheduler, restore executor, credential rotation automation, index mutator,
orphan deletion, receipt archival, history rewrite or deployment is included in 8F.

## Release packaging

See [Release packaging and checklist](RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.


## Phase 10A timeline control procedure

**10A foundation, extended by the 10B server procedure below.** Server protocol
2 fencing now exists; client queue timelines still await 10C/10D. Existing offline restore/replay restrictions above continue to apply;
OPEN readiness alone does not establish restore safety or authorize traffic.

External prerequisites: retain an independent durable operator record containing
expected active timeline, maintenance/write latch, restore event/reference and
operator audit evidence. Keep that record outside the restored Mongo failure
boundary. Protect issued-ID history there so IDs cannot be reused after local
Mongo audit rollback. No vendor or retention guarantee is implemented here.

1. Hard-close ingress and stop/disable all writes, including scheduled/admin jobs.
   Drain/kill every old backend; isolate database endpoints and restrict old
   credentials/network access as appropriate. An old process with network access
   to an old/uncontrolled DB cannot be protected by this software. Updating a
   deployment environment variable alone does not change existing processes.
2. Record external maintenance/write latch CLOSED and intended timeline/event in
   the independent record. Generate a fresh random UUID v4 deliberately using an
   operator-controlled generator; never derive one from a counter/time/build or
   ask startup, preflight, CI or readiness to generate/discover one. Retain the
   public event/target/operator references and exact command request externally.
3. From the reviewed release checkout run `npm run build`. Inject the full validated
   production configuration without loading .env, including DATA_TIMELINE_ID and
   DATA_WRITE_MODE. Use transaction-capable Mongo and an operator identity with
   reviewed schema/index/write permissions. Runtime credentials should have no
   collection-validator/index administration or validation-bypass authority.
4. Inspect, then choose exactly one explicit action below. Replace angle-bracket
   placeholders; no command is run automatically. All mutations require the exact
   database name confirmation, explicit public event/target/operator references,
   and production/maintenance confirmations. Never put secrets in arguments.

```text
node dist/src/tooling/timeline-control-cli.js inspect
node dist/src/tooling/timeline-control-cli.js initialize --target <timeline-A> --event <init-event> --operator <ticket> --confirm-database <database> --confirm-production --maintenance-isolated
node dist/src/tooling/timeline-control-cli.js close --target <timeline-A> --event <close-event> --operator <ticket> --expected-timeline <timeline-A> --expected-state OPEN --expected-version <inspected-version> --confirm-database <database> --confirm-production --maintenance-isolated
node dist/src/tooling/timeline-control-cli.js install-timeline --target <fresh-timeline-B> --event <restore-event> --source <restored-source-timeline> --operator <ticket> --expected-timeline <current-Mongo-timeline> --expected-state CLOSED --expected-version <inspected-version> --confirm-database <database> --confirm-production --maintenance-isolated
node dist/src/tooling/timeline-control-cli.js open --target <timeline-B> --event <open-event> --operator <ticket> --expected-timeline <timeline-B> --expected-state CLOSED --expected-version <inspected-version> --confirm-database <database> --confirm-production --maintenance-isolated
```

| Action | Required state and effect |
|---|---|
| inspect | Read-only raw control inspection; no provisioning or repair; safe failure on absent/malformed/duplicate control |
| initialize | External latch CLOSED; expected external timeline equals supplied target; creates absent singleton CLOSED plus audit event in one transaction; strict schema and unique index explicitly provisioned; existing conflicting control refused |
| close | External latch CLOSED and exact expected OPEN Mongo timeline/controlVersion; same timeline becomes CLOSED; accepts differing external expectation so a restored source can be closed safely under hard isolation |
| install-timeline | External latch CLOSED, external expectation equals explicit fresh B; exact expected CLOSED Mongo timeline/version; requires explicit source provenance; B differs from current A and every locally known initialized/installed ID; remains CLOSED |
| open | External latch OPEN and expectation equals Mongo target; exact expected CLOSED timeline/version; changes only writeState/controlVersion; hard external maintenance remains in place |

First deployment: with external A/CLOSED and infrastructure isolated, initialize
absent metadata CLOSED. Provision all other critical indexes and upload storage.
Inspect and preserve evidence. Set operator configuration A/OPEN only for a
separately authorized open action, while ingress and the deployed fleet remain
isolated. Open Mongo A separately; start/reconfigure the intended fleet with
A/OPEN and verify readiness before considering an independently authorized canary.
No production traffic is authorized by this document or the 10A implementation.
Normal restart, deploy, scaling and build/protocol changes must preserve A; never
rerun initialize with a new ID. Probe/validation/preflight paths perform no control
writes. Local/test initialization uses these same explicit primitives on disposable
replica sets with synthetic IDs; there is no implicit NODE_ENV bootstrap.

Restore A to B: complete hard isolation first, close the independent latch, and
explicitly close Mongo before restore where possible. Follow the coordinated full
DB/upload restore procedure above; a restored backup may contain an older OPEN
control record and old event history. Keep ingress/process/DB isolation enforced
throughout. Inspect the restored record and explicitly close its actual timeline
with its actual CAS version; never temporarily route traffic to read it. Record
fresh B and restore event externally with latch CLOSED, then install B while Mongo
is CLOSED. Include the actual restored source ID, which may differ from the last
active external timeline. Preserve timelinecontrol, its strict/error validator,
unique singleton index and timelinecontrolevents in coordinated backups/inventory.
An old backup without metadata needs the explicit first-deployment initialization
path under isolation using a fresh externally recorded B, not automatic recovery.

Only after a complete restore, verified provenance/index/storage/transaction
checks, matching external and Mongo B, independent audit evidence and the existing
offline replay restrictions are satisfied may a separately authorized operator
prepare the open step. Keep hard isolation while changing the external operator
configuration to B/OPEN and opening CLOSED B through CAS. Configure every new
instance to B/OPEN; old A instances remain unready. Never reopen on mismatch,
partial restore, missing evidence or an unresolved pre-10B replay safety gap.

Each mutation records an event with public request, previous/target/source IDs,
result state/version and timestamp atomically with control. Retry an uncertain
outcome using the **same event and exact request**, after inspect. A matching
last event/state/version returns the existing result without another transition;
changed parameters, reused event, later transitions or stale CAS fail. Fence
increments do not change the operator controlVersion. Concurrent operators cannot
both commit the same expected transition. Known locally reused timeline IDs are
rejected; external issued-ID history is authoritative across audit rollback.
Do not substitute a new event/CAS blindly after a conflict or timeout.

Mongo-local audit is useful but **NOT the independent external audit source**.
Retain command output and operator evidence externally; repository code does not
provide durable external retention. If data is restored without changing/closing
independent external control and without hard write isolation, software cannot
reliably know a restore happened. This architecture depends on an enforced restore
procedure, restricted access and independently retained evidence.

These files are classified OPERATOR_TOOL in RELEASE_PACKAGING.md and deliberately
excluded from the runtime artifact allowlist. There is no HTTP controller, startup
hook, preflight invocation or CI invocation against real infrastructure. Production
readiness verifies schema/index/control only, never repairs them. Safe operational
readiness diagnostics include TIMELINE_CONTROL_UNAVAILABLE, TIMELINE_MISMATCH and
WRITES_CLOSED, logged on diagnostic transitions rather than every request. CLI
success emits a public operator_timeline action with resulting control metadata;
failures omit raw Mongo errors, paths, credentials and stack traces.


## Phase 10B rollout and restore reopening

Backend protocol 2 support does not migrate existing web/Flutter clients: both
remain v1. ALLOW_LEGACY may be used only for pre-restore migration while control
and deployment expectation match and writes are intentionally OPEN. All server
transactions are fenced, but a legacy offline intent still has no origin proof.
Public/store release and production traffic remain unauthorized.

After a real restore: retain hard ingress/process/DB endpoint isolation and CLOSED
external latch throughout full DB/upload reconciliation. Issue fresh B externally;
close the actual restored Mongo control, install B CLOSED, and preserve independent
audit/issued-ID evidence. A timeline-aware client cohort must exist before reopening.
Set CLIENT_PROTOCOL_POLICY to ENFORCE_MUTATIONS on the operator environment and
all replacement instances before the separate open step. The CLI refuses to open
known restored metadata in ALLOW_LEGACY; the write gate also refuses known restored
metadata with a legacy-permitting policy. Never use old v1 clients for a post-restore
canary. Missing provenance on older backups does not waive these operator rules.

### Phase 10E disposable drill evidence and reopening decision

[The disposable drill](PHASE_10E_RESTORE_DRILL.md) now exercises physical rollback
of synthetic domain documents, receipts, AI barriers, control history and uploads
on a real transaction-capable replica set. It is correctness evidence, not a
backup implementation or a witnessed production restore. All first-party clients
now declare protocol 2; the earlier rollout sections are historical checkpoints.

Maintain this order for any separately authorized real restore:

1. Record external RESTORING status and enforce the independent CLOSED latch,
   ingress restrictions and write isolation.
2. Stop or network/DB-isolate old applications, workers and stale deployments.
3. Restore coordinated Mongo and shared upload state under continued isolation.
4. Audit the restored source, indexes, receipts/barriers and upload references
   against independently retained coordinated evidence. Missing receipts or
   surviving receipts alone do not prove the corresponding domain effect.
5. Record a fresh, never-issued B externally and install it CLOSED using the
   actual restored source/control version. Retain issued-ID history outside Mongo.
6. Start B-configured compatible instances with the independent latch CLOSED.
7. Verify old A, unknown/missing provenance and stale instances cannot write;
   audit B CLOSED again. No automatic repair or receipt reconstruction is allowed.
8. Only with matching evidence, hard isolation and explicit operator authorization,
   configure ENFORCE_MUTATIONS for the replacement cohort and open restricted B
   for a controlled canary. A v1 success under ALLOW_LEGACY proves no intent origin.
9. Admit the compatible cohort only after canary validation and pending client
   reconciliation. A records and destructive clear evidence remain A.
10. Reopen traffic only under a separate production authorization.

Read-only restore consistency checks never perform the open step. Orphans,
broken references, receipt/domain/barrier disagreement, missing manifest/index
evidence or an incomplete audit require continued CLOSED isolation and review.
Do not delete or regenerate evidence to make an audit pass. The fence cannot
cancel a provider call already in flight; external hard isolation is mandatory.

The shared control record serializes competing transactions. The disposable
measurements show conflicts/retries and bounded 503 failures under larger bursts;
they establish no production capacity SLA. Capacity must be validated for the
deployment and canary load. Rate limits remain process-local: control instance
count and use trusted ingress/global limiting or an independently reviewed shared
limiter before horizontal scale. All instances need the same persistent upload
tree; divergent local disks are not safe shared storage. No Redis/object-storage
migration or production enforcement/default change is part of this phase.

Inspect discovery without sending mutations: GET /compatibility is public/no-store
and works while general readiness is CLOSED. Unknown/mismatched control yields
no trusted public timeline. Verify exact server-v2/client-cohort capability and
both control latches; a revision/build label alone is insufficient. Readiness must
pass on every replacement instance before independently authorized traffic.

Inventory existing mutationreceipts, flashcardoperations and progressresets without
bulk rewriting them. Their global operation identities and indefinite retention
remain unchanged. New receipts carry immutable dataTimelineId. V2 replay of missing
provenance requires reconciliation (409 RECEIPT_TIMELINE_UNVERIFIED); cross-timeline
receipt reuse is rejected (409 SERVER_TIMELINE_CHANGED), even with a current header.
Do not delete/relabel a receipt, replace its operation ID, or weaken its unique index
to make a retry succeed. The reset recovery GET also checks timeline provenance.

Every public durable writer is FENCED: progress completion/reset, all flashcard
mutations, Community create/update/delete/reaction, AI send/clear, registration,
guest identity creation and profile updates. Image allocation has fresh admission,
owned-file compensation and a separate final DB fence. Login is NO_DURABLE_WRITE;
writing feedback and pronunciation assessment are STATELESS (bounded ephemeral
spools/provider effects only). Ordinary GET handlers have no incidental persistence
writes. Runtime lesson bootstrapping has been removed; reviewed catalog provisioning
is an explicit operator task, including in local/disposable setups.

Progress audit --apply/rollback, local lesson replacement/generation and timeline
control are OPERATOR_ONLY. Domain repair/replacement tools require hard maintenance,
all public/background writers drained, and both external and Mongo write controls
intentionally CLOSED, with matching expected timeline and retained operator evidence.
Do not attach public client headers to these tools. Their separate operator authority
is not permission to run them during OPEN application traffic. No operator tool is
invoked by startup, readiness, preflight or CI against real infrastructure.

Observe timeline_request_missing, timeline_request_mismatch, timeline_write_blocked,
timeline_fence_conflict and receipt_timeline_conflict, plus transaction retry counters.
Legacy admissions are counted without per-request log spam. Shared-document contention
causes real bounded transaction retries; do not substitute read-only assertions or
remove the fence. Tests exercise four/six concurrent operations, not a production
throughput benchmark. Characterize transaction rate, retry/latency distribution and
fleet capacity in 10E before any release decision.
