# Phase 11B-C1 independent timeline authority

C1 implements independent control for disposable staging, not production authorization, shared uploads or unconditional multi-instance safety. The Phase 10 transactional Mongo fence, immutable receipt provenance, protocol v2 headers, client synchronization semantics and response codes remain in force.

## Trust boundaries and consistency

The legacy path compares injected DATA_TIMELINE_ID/DATA_WRITE_MODE with Mongo's timelinecontrol singleton. TimelineWriteGate reads it; MutationTimeline touches it in every domain transaction and checks again before commit. TrafficLifecycle also gates business reads with possible hidden writes. Clients discover state only through /compatibility and never contact the authority.

LEGACY_LOCAL preserves this compatibility behavior and is explicitly not independent restore control. DURABLE_REQUIRED adds an uncached PostgreSQL primary read to the same gate. Environment, storage identity, current UUID, pinned generation, OPEN state and complete ledger/audit must agree. Missing state/history, wrong identity/generation, standby, timeout, cancellation/shutdown or unavailable authority fails closed. Missing reader injection cannot bypass required mode. Normal startup provisions no authority rows and performs no reconciliation.

PostgreSQL 17.9 supplies transactional row locks, uniqueness, WAL persistence and exclusive operator advisory locks. Each transition function atomically checks expected revision and commits state, issuance and audit. Runtime reads use one statement on the primary, not a replica or cached result. Operator coordination uses one dedicated connection. See [isolation](https://www.postgresql.org/docs/17/transaction-iso.html), [locking](https://www.postgresql.org/docs/17/explicit-locking.html) and [driver transactions](https://node-postgres.com/features/transactions).

The authority-data volume/control network are independent of Mongo's volume/network. No control-store port is published. The runtime reader role can SELECT the verification view and invoke narrowly scoped functions to begin/finish its own filesystem permits. It cannot update control state, issue IDs, reopen writes, edit tables or settle another connection's permit. The operator role can read audit/ledger and invoke transitions, not edit tables or mint administrator isolation receipts. UPDATE/DELETE/TRUNCATE protection makes issued IDs, transition/effect events and isolation receipts append-only. Database owners/superusers and storage administrators remain trusted: they can defeat schema controls. Protect their separate credentials, primary ownership and backup plane.

One authority database holds one explicitly initialized environment. The ledger's UUID primary key prevents reuse across all generations retained in that store; environment/generation is also unique. State records environment, storage identity, timeline UUID, generation, revision, mode, timestamp and last event. Audit records authenticated database actor, safe public action references, exact public request/result and timestamp, with unique event and environment/revision. Request keys cannot carry credentials or URLs. Operators must never place secrets in public references. Read validation checks current event/ledger consistency and counts against generation/revision; missing history is never regenerated.

Generation starts at one and increases only on fresh allocation. Revision increases on each transition/install intent. Exact same-event retries are permitted only while current; altered or superseded event retries fail. A lost response never authorizes generation of a replacement ID.

PostgreSQL fsync/WAL durability and stable primary routing are required. Single-node disk loss, malicious control-plane administration and split brain are not solved. Back up authority storage independently, preserving the latest ledger/audit. Never restore an old authority alongside Mongo or rewind it to match Mongo. If independent recovery history may omit an issued ID, keep every writer isolated and investigate; do not initialize anew. No zero-loss or automatic-recovery claim is made.

## State machine and the atomicity boundary

| Action | From → to | Enforced prerequisites |
|---|---|---|
| initialize | absent → CLOSED | explicit new environment, revision 0, empty Mongo domain, authenticated operator |
| open | CLOSED → OPEN | matching Mongo timeline, indexes/transactions/local uploads, upload recovery and isolation references, v2 enforcement, explicit OPEN latch |
| close | OPEN → CLOSED | admission closes first; success requires Mongo barrier AND zero unsettled filesystem permits |
| maintenance | CLOSED → MAINTENANCE | committed Mongo CLOSED at supplied version, explicit isolation reference |
| allocate | MAINTENANCE → MAINTENANCE | never-issued target UUID, CLOSED Mongo; generation increases; no A-to-A |
| seal-mongo | MAINTENANCE → MAINTENANCE | durable isolated sealing intent, then closes a restored OPEN source singleton |
| install | MAINTENANCE → MAINTENANCE | durable install intent, then existing Mongo install-timeline action |
| reconcile | MAINTENANCE → CLOSED | Mongo/authority agreement, Mongo barrier version, core checks, explicit upload recovery reference |
| resolve-effect | CLOSED → CLOSED | dead permit connection, administrator isolation receipt bound to effect/environment/generation/revision, explicit file recovery and Mongo CLOSED proof |

An isolation/recovery reference is an operator attestation, not automatic proof about external processes or recovered upload bytes. Operator credentials are a trusted control capability. The application cannot invoke the transition function. The supplied CLI additionally restricts mutation to the fixed disposable service/database targets and explicit intent. No public operator API exists.

There is no cross-store transaction. An early authority read cannot fence an existing Mongo transaction:

1. The coordinator acquires an exclusive PostgreSQL advisory lock for the operation. Competing coordinators serialize and stale revisions still fail CAS.
2. Close PostgreSQL admissions. Existing work may still be draining: this CLOSED record alone is not a completed drain.
3. Close Mongo using applyControlRequest, which writes the singleton already touched by domain transactions. An overlapping old writer and close cannot both commit against that old singleton version. On conflict, remain independently CLOSED, drain/terminate writers and retry the identical close plan. Never advance based only on step 2.
4. Only after the committed Mongo CLOSED barrier AND every durable filesystem permit has settled can maintenance and B allocation proceed. A transaction with the stale A fence either completed before the barrier or must abort; new required-mode admissions are denied. Native filesystem effects already issued can drain after admission closes; their durable records prevent a successful close barrier or restore transition until they settle or are explicitly isolated.
5. Hard-isolate every application/background/operator and legacy writer before any restore. Processes that bypass the fence must be stopped and access independently revoked. The nontransactional file boundary also requires isolation; C1 does not implement shared uploads or filesystem transactions.

This provides deterministic cooperating Mongo-writer evidence under the required ordering. An operation that passed its final authority check can finish before the Mongo close barrier, including during a newly observed authority outage. No instantaneous distributed revocation or unconditional multi-instance claim is made. The final stale-writer disposition remains PARTIAL because orchestrator-wide isolation, old credentials/sessions and file writers are external prerequisites.

## Restore/recovery workflow and crash boundaries

Use reviewed public JSON request plans, fresh event UUIDs and explicit expected revisions. The CLI never loads .env, runs a real restore, repairs history or chooses timeline UUIDs.

1. Close ingress and freeze deployment changes. Inventory/drain/stop writers. Execute close and inspect both stores. If only PostgreSQL closure committed, Mongo might still be OPEN; remain isolated and retry the same plan after draining. Authority outage never justifies opening Mongo.
2. Execute maintenance with the actual Mongo CLOSED version and isolation reference. Verify independent authority backups and the approved coordinated Mongo/upload recovery point. Select a target distinct from active and restored source timelines.
3. Execute allocate for fresh B. A crash after issuance consumes B permanently; inspect/retry that exact event, never issue B again under another event.
4. An independently authorized operator can now restore Mongo and coordinated uploads under hard isolation. Development only simulates rollback of synthetic Mongo control state. A restored OPEN/A singleton cannot grant required admission while independent control is MAINTENANCE/B.
5. Execute seal-mongo to close any restored OPEN Mongo singleton with the Phase 10 operator protocol under hard isolation. The legacy mutation CLI refuses required-mode calls. Never set PostgreSQL OPEN merely because restored Mongo says OPEN.
6. Execute install with the restored Mongo CLOSED version. PostgreSQL first records MAINTENANCE/B install intent; Mongo then installs B CLOSED with source provenance. Crash before Mongo update: retry the exact intent. Crash after Mongo update: retry observes B CLOSED and does not re-install or reissue. The Phase 10 protocol rejects same-source target.
7. Configure all future backends for B and its pinned generation, initially CLOSED and v2 enforced. Verify indexes, transaction topology, domain/receipt consistency and coordinated upload recovery. A local writable probe does not prove restored upload contents; retain an explicit recovery reference.
8. Execute reconcile. Both stores and checks must agree; PostgreSQL becomes CLOSED. Restart/crash here never opens admissions.
9. Set explicit deployment latch OPEN and execute open. Mongo opens first, PostgreSQL last. Crash between them remains independently CLOSED; inspect and retry the identical plan. There is no automatic reopen/reconciler.
10. Start only reviewed required-mode backends, verify full readiness and discovery, then separately authorize ingress. Synthetic success grants no production authorization.

CAS failure requires inspection, not overwriting newer state. An ambiguous step remains CLOSED/MAINTENANCE. Loss of the operator connection/lock prevents further authority work; an already committed Mongo change cannot itself open PostgreSQL.

## Configuration and disposable validation

DEPLOYMENT_PROFILE and TIMELINE_AUTHORITY_MODE distinguish LEGACY_LOCAL from DURABLE_REQUIRED. Required profile rejects legacy fallback. Required mode needs reader TIMELINE_AUTHORITY_URL, explicit ENVIRONMENT/STORAGE_ID identities and a positive pinned GENERATION. Verified PostgreSQL TLS is required outside disposable authority DNS. AUTHORITY_OPERATOR_URL/INTENT are tooling-only; no operator/admin credential belongs in runtime or clients.

Generate three distinct 64-character lowercase hex passwords for disposable admin, reader and operator roles; examples have placeholders only. The PostgreSQL initializer creates roles/schema on a NEW volume, not authority state. Never silently adopt an existing B2 data set as a new authority environment. Existing deployments with missing authority remain closed.

Run the offline staging validator/tests and Compose configuration check. Build images, start independent authority/Mongo and explicitly bootstrap correctness indexes. Mount a reviewed public plan read-only into backend-tools; invoke durable-control-cli with --request, --confirm-environment and --new-environment only for first initialization. Tools verify the same uploads namespace; no C2 recovery/shared-storage guarantee follows.

The explicit Docker integration suite is src/operations/durable-authority.integration.ts, run with Jest --testRegex durable-authority.integration.ts inside the backend build image on control/database networks. It requires synthetic C1_TEST_ADMIN_URL, C1_TEST_READER_PASSWORD, C1_TEST_OPERATOR_PASSWORD and C1_TEST_MONGO_URI and creates only uniquely named synthetic databases. It is excluded from runtime packaging and never counted as passing if not explicitly run.

Example first public plan (substitute fresh action UUID and the actual disposable identities):

```json
{"action":"initialize","environment":"language-coach-11b-local","storageIdentity":"language-coach-11b-local_authority-data","timelineId":"44444444-4444-4444-8444-444444444444","eventId":"55555555-5555-4555-8555-555555555555","expectedRevision":0,"operatorReference":"local-c1-ticket"}
```

Mount that reviewed plan read-only as /plans/request.json, set the ignored env's STAGING_AUTHORITY_OPERATOR_INTENT to I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY, and run:

```sh
docker compose -f deployment/staging/compose.json --env-file deployment/staging/.env.staging.local --profile tools run --rm -v /absolute/disposable-plan.json:/plans/request.json:ro backend-tools node lingua_ai_backend/dist/src/tooling/durable-control-cli.js --request /plans/request.json --confirm-environment language-coach-11b-local --new-environment
```

Subsequent public plans include the observed expectedRevision and appropriate isolationReference, mongoClosedVersion and uploadRecoveryReference; never infer or auto-increment them without inspection. The read-only live companion is `node lingua_ai_backend/dist/src/tooling/authority-preflight-cli.js --manifest /plans/manifest.json` in backend-tools, after strict offline manifest validation. It checks actual authority revision/generation/mode and Mongo/core/storage agreement without opening or reconciling anything. Normal `preflight:deploy` stays offline and reports only whether independent authority is configured.

Validate persistence across authority restart, CAS races, outage/timeout, ledger damage, stale generation, crash boundaries and Mongo-only rollback. A strict public manifest records actual artifact/model identities plus authority type/environment/storage/backup identity, intended timeline, generation, revision and mode; live evidence compares these to the independent state. Static passes never contact services or authorize release.

The triaged Multer async-filter issue remains conditionally unreachable: no file-filter implementation or client protocol is changed. Re-triage before adding asynchronous filters.

## R1 review conditions and corrections

The coordinator rejects OPEN from MAINTENANCE or from an already OPEN authority before changing Mongo. An exact completed OPEN retry is allowed only if Mongo is already OPEN; the SQL audit verifies the identical request. It cannot repair a CLOSED Mongo beneath an OPEN authority. This matters because an error returned after opening Mongo would not revoke an existing independent OPEN authorization. Operator evidence fields are validated before cross-store work.

The legacy progress-audit apply/rollback primitives and CLI are disabled whenever either required-mode configuration flag is selected. Read-only audit remains available. These tools do not acquire the Mongo timeline fence; clearing their configuration or running old binaries is not a supported repair procedure. Initialization rejects malformed or reused passwords across all three PostgreSQL roles, including the superuser.

The review does not establish permanent non-reuse after PostgreSQL itself is rewound. Its internally consistent old snapshot passes the current row/history checks; no external high-water witness is implemented. Before any authority recovery, independently isolate every writer, prevent replacement processes from starting, verify the complete issued-ID history and maximum committed generation/revision against separately controlled immutable records/WAL retention, and obtain explicit security/operator approval. A backup name in a manifest is not this evidence. If history may be incomplete or the recovered state was OPEN, keep the service unreachable to every backend and prohibit reopening/bootstrap. Independently verified backup ownership, retention, recovery freshness and approval controls remain NOT VERIFIED. Implementing a durable external witness would require a separately reviewed design.

The restore isolation prerequisite remains operational. Block new admissions with independent CLOSE; identify active handlers through TrafficLifecycle shutdown telemetry (a timeout or nonzero count is not a drain); stop every application, tooling and development writer; disable restart/rollout paths and revoke their Mongo/network access; verify process/container exit and independently inspect outstanding Mongo sessions/transactions until no pre-barrier write can survive. Only then attest isolation and proceed to allocation/restore. On a crash or connectivity loss, maintain isolation and investigate server-side work rather than inferring completion. The coordinator cannot verify these external steps from a reference string.

The R1 filesystem finding above describes the pre-R2 implementation. R2 adds the durable completion barrier below; no filesystem transaction or shared-upload mechanism is claimed. Global stale-writer fencing remains PARTIAL because unknown historical processes and production credential revocation remain external prerequisites.

## R2 durable filesystem completion barrier

Mongo's existing transaction fence remains intact. PostgreSQL adds `file_effects`, append-only `file_effect_events`, and append-only `file_isolation_receipts`. File permit registration serializes with operator transitions using the existing advisory key and checks OPEN, environment/storage, UUID, pinned generation, intact history and absence of orphaned permits. Registration commits before filesystem mutation. There is no lease expiry or startup reaper. Pending permits are capped at 32 globally and eight per backend process; saturation denies work rather than dropping history.

Store/remove/compensation and runtime writable-readiness probes carry permits through all awaited native work, including handle close. Fresh checks occur before native mutation steps and after the operation. The complete community mutation and its cleanup share the original immutable admission, including direct service callers. A delayed A cleanup cannot acquire a B permit. The legacy owned-inode cleanup exception is disabled in required mode. Already issued native syscalls cannot be atomically revoked by a later PostgreSQL write; their pending permits make that drain visible and prevent maintenance/restore from passing them. See Node's [FileHandle close contract](https://nodejs.org/docs/latest-v22.x/api/fs.html#filehandleclose) and PostgreSQL's [advisory-lock semantics](https://www.postgresql.org/docs/17/explicit-locking.html).

The owning PostgreSQL backend PID and backend-start timestamp bind settlement to that connection. The runtime can finish only its own permit, after native work settles. Finish deliberately does not acquire the operator advisory lock, so CLOSE cannot deadlock completion. CLOSE first commits admission CLOSED and the Mongo fence; if any permit remains it fails with no completed-barrier claim. Exact CLOSE retry succeeds only after zero pending permits. SQL itself rejects maintenance, allocation, installation, reconciliation and reopening while a permit remains, even if an operator supplies an isolation string.

Connection/process loss leaves an ACTIVE permit durably present. Orphaned permits degrade readiness and deny new runtime authorization, even if the control row was OPEN before the failure. Normal restart never clears them. A lost release acknowledgement is conservatively unavailable; a committed settlement is safe because native work had already finished. A failed or interrupted create may leave an unreferenced partial file; an interrupted post-delete cleanup may retain a file. Preserve uncertain bytes for explicit reconciliation; never infer absence of metadata from a failed read or run old cleanup after restoration. Domain/receipt transactions remain atomic within Mongo; filesystem bytes and metadata do not become one transaction.

Readiness writes are permitted only under OPEN with a durable permit. CLOSED/MAINTENANCE live preflight uses containment/permission checks without writing and explicitly reports `uploadWriteProbeVerified:false`. Controlled operator open/reconcile probes run under the exclusive operator lock after the pending-permit check. Never treat a permission-only check as a write probe.

### Interrupted-permit recovery and isolation evidence

1. Keep admission CLOSED. A failed close is not an authorization to restore. Inspect pending permits using the operator's read privileges; preserve the original close event and recovery plan.
2. Freeze deployment/restart changes. Stop every application, legacy tool and filesystem writer. TrafficLifecycle counts response and active-handler completion; a disconnect, timeout, nonzero count or lost Mongo acknowledgement is not a successful drain. Verify actual process/container exit, not only request cancellation.
3. On the Docker host, run `node deployment/staging/verify-file-isolation.cjs --project language-coach-c1-r2-validation`. This refuses running writers, enabled restart policies, unexpected private-network endpoints, wrong store/volume identities, outstanding Mongo operations/idle transactions, live authority client sessions or an OPEN authority. It uses Mongo's [currentOp stage](https://www.mongodb.com/docs/v7.0/reference/operator/aggregation/currentop/) without printing commands or user data. It is a snapshot gate; keeping deployments frozen remains an operator obligation.
4. For an interrupted permit only, the host administrator may append `--effect <UUID> --reference <public-ticket> --issue-receipt`. The verifier hashes its observed isolation evidence and records a durable receipt through an administrator-only function. Reader/operator roles cannot mint or edit it. A lost connection alone is insufficient evidence that native work stopped.
5. After explicit upload reconciliation, the normal operator submits `resolve-effect` with effectId, isolationReceiptId, effectRecoveryReference, isolationReference, current expectedRevision and actual mongoClosedVersion. SQL verifies the dead owner and the administrator receipt's exact effect/environment/storage/timeline/generation/revision binding. It records ISOLATED plus a transition audit and remains CLOSED. A stale/forged receipt or live owner is rejected.
6. Recheck zero pending effects and the isolation snapshot. Then retry the still-current close plan, or inspect the new revision after an explicit resolution before choosing the next legal transition. Do not reuse a superseded event. Allocate fresh B only after the completed barrier, and follow the existing restore/install/reconcile/open protocol.

The verifier is a host-only tool requiring Docker administration; it is absent from backend and tooling images. It does not run a restore, stop unrelated resources, revoke production credentials or grant production authority. PostgreSQL administration remains trusted. A compromised host administrator can bypass database protections; no local snapshot gate proves future orchestration or multi-instance safety.

### Bootstrap, schema and backup constraints

Index bootstrap is now NEW-EMPTY-ENVIRONMENT ONLY. In addition to the existing disposable acknowledgement, supply `STAGING_AUTHORITY_BOOTSTRAP=I_ACKNOWLEDGE_NEW_EMPTY_ENVIRONMENT`, required mode and explicit operator intent/credentials. It serializes with initialization and rejects any initialized authority, retained history, pending effects or Mongo application data before DDL. Required-mode development auto-index/create and the local lesson replacement utility are disabled. Existing deployments must never use bootstrap as repair.

R2 requires the `DURABLE_EFFECTS_V1` manifest contract and matching schema view. An old/missing schema fails closed; normal backend startup performs no migration. A production migration preserving all issued/audit rows requires separate review. Development may explicitly refresh only a verified empty, never-initialized disposable R2 schema. Retained C1/B2 authority and Mongo volumes are not migrated or restored by R2 validation.

PostgreSQL backups remain separate from Mongo backups. A coherent old PostgreSQL snapshot can forget IDs, permits and receipts. Before any authority recovery, isolate every writer and independently verify the complete issued ledger and latest acknowledged generation/revision against separately controlled retained history. Missing continuity evidence must keep infrastructure isolated. Open/reconcile requests now require an audited `historyContinuityReference`; that is an approval locator, not proof of an external anchor. No new external service or absolute never-reuse guarantee is introduced. Authority anti-rollback remains CONDITIONAL.

The R2 Docker integration suite includes `durable-file-effect.integration.ts`; its real PostgreSQL outage case requires the host orchestrator in `.release-validation/11bc1-r2/runtime.cjs` to honor deterministic `/signals` barriers. Running a regex-selected subset is not the full suite. Full validation must run both authority and file-effect suites, all repository baselines, strict/static/live deployment checks and the host isolation gate. See [the writer inventory](RESTORED_STATE_WRITERS.md).
