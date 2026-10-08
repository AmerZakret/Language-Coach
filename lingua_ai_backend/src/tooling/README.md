# Legacy progress audit

This standalone developer tool is not registered with Nest or exposed through
HTTP. It reads raw MongoDB records without schema defaults, seeding, or hooks.
It does not load `.env`: supply `MONGODB_URI` explicitly through the environment.
No production audit or repair is part of the tests or development workflow.

Build the backend, then run `node dist/src/tooling/progress-audit-cli.js --help`.
The default run is read-only and limited to 100 users:

```text
node dist/src/tooling/progress-audit-cli.js --user <MongoDB-ID> --output <new-report.jsonl>
node dist/src/tooling/progress-audit-cli.js --limit 100 --batch-size 50 --output <new-report.jsonl>
node dist/src/tooling/progress-audit-cli.js --all --batch-size 100 --output <new-report.jsonl>
```

`--after <MongoDB-ID>` resumes the ordered owner scan. `--all` additionally scans
all progress references for orphan/malformed ownership; limited owner scans
explicitly report that the global orphan scan was not run. A targeted `--user`
scan also checks references to that owner, even if the owner no longer exists.
Reports stream as JSON Lines (MongoDB Extended JSON for exact BSON values).
Counters go to stderr. Each user is isolated on failure; any failed user makes
the CLI exit unsuccessfully. Files use exclusive creation and are not overwritten.

## Evidence and classifications

Findings have independent categories and one of `DETERMINISTIC_REPAIR`,
`AMBIGUOUS_REVIEW`, `DANGEROUS_OWNERSHIP`, `SAFE_COMPATIBILITY`, or `INFORMATIONAL`.
Per-user reports include level/XP summaries, epochs, provenance counts, exact
known row award sums, reconstruction eligibility, category/classification
counters, bounded finding samples, and derived-field repair proposals.
At most 200 finding details are retained per user; counters retain all findings.
Cursor batches are bounded to 1-500 documents. No entire collection is loaded
into application memory. Oversized server aggregations fail that user rather
than silently returning incomplete evidence.

Missing/invalid awards, duplicate rows, bad ownership/status/epoch, or absent
language metadata disqualify the applicable complete reconstruction. Explicit
award sums include available durable row values and are never asserted to be
authoritative aggregates when evidence is incomplete. No current lesson reward
is used as historical proof. Even complete row evidence cannot prove that older
non-lesson awards or deleted rows never existed: XP mismatches remain review-only.

Known English/Turkish aliases use the same additive read as runtime code. They
are never consolidated or deleted. Coexisting alias buckets are ambiguous and
block automatic language-level repair for that language. Unknown lesson IDs,
score/status issues, ownership, and completion rows are never rewritten.
Reports exclude emails, names, credentials, and password hashes from user data.
Full-record hashes detect concurrent edits without exposing those fields.

## Optional apply and rollback

Mutation requires **explicit operator authorization**, `--apply`, and a new
`--output` file. It requires transaction-capable MongoDB. It is limited to
`level` and `levelPerLanguage.<canonical-code>`, derived from valid stored XP.
It never changes XP, awards, epochs/revisions, ownership, alias buckets, scores,
lesson IDs, or completion rows. Dangerous ownership or invalid owner epochs
block all proposals for that user.

Each user is re-read, compared with the audit fingerprint, and re-audited inside
its own snapshot transaction. Proposals supplied by a caller are not trusted.
A conflict/retry after a concurrent edit refuses the stale repair. Repair and
durable evidence in `progressauditrepairs` commit together; no new receipt index
or migration is required. Records include exact original/new fields, timestamps,
owner ID, epoch/write revision, and before/after full-state fingerprints.

```text
node dist/src/tooling/progress-audit-cli.js --user <MongoDB-ID> --apply --output <new-apply.jsonl>
node dist/src/tooling/progress-audit-cli.js --rollback <receipt-ID> --apply --output <new-rollback.jsonl>
```

Rollback restores only the recorded derived fields and their original absence,
including a newly introduced parent map. It refuses if any user field changed
since repair, validates restored state, and records completion transactionally.
There is no blind rollback or override. Retain both reports and database receipts;
if a receipt is unavailable or the user has changed, manual review is required.

Prefer read-only database credentials for production dry-runs and review the
bounded report before separately authorizing any apply. These commands are
examples only; no production connection or mutation is performed by tests.
