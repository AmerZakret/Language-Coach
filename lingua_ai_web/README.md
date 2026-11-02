# React + TypeScript + Vite

Run `npm ci`, then `npm test` for the full Node/browser-context suite. See
[Local test baseline](../TESTING.md) for test requirements and the documented
prototype-only status of `src/new_components`; those files are not release inputs.

Production builds require explicit `VITE_API_URL`; localhost fallback is development
only. See [Production configuration](../PRODUCTION_CONFIGURATION.md) for endpoint
validation and the deliberate self-hosted override.

## Production artifact

Use Node 22.14.0 / npm 10.9.0 (declared Node 22/npm 10 compatibility lines).
Build with explicit `VITE_API_URL=https://api.example.invalid` and public
`VITE_BUILD_ID=candidate-build` for local validation. Production maps are disabled.
The artifact includes SPA output, `release.json` for current-tab compatibility and
`release-manifest.json` for safe component/version/build/protocol/API metadata.

Serve index.html fallback for application routes, real 404s for missing metadata/
assets, revalidated HTML and release.json, and immutable hashed assets. Preserve
saved queues/intents during reload or rollback. The current large main chunk is
an accepted release advisory with a separate bundle-analysis follow-up.

## Release packaging

See [Release packaging and checklist](../RELEASE_PACKAGING.md) for artifact allowlists,
source-map policy, validated toolchains, build/version metadata and operator-only
identity/signing/configuration requirements.


## Phase 10C: timeline-aware web recovery

Web uses protocol 2. GET /compatibility (no-store) confirms the current dataset
timeline at bootstrap, on foreground/reconnect and before durable drains. New
operations capture it before persistence and send their stored X-Data-Timeline;
retry never substitutes a newer value. Previously confirmed timelines support
offline creation; never-known timelines block replayable server work.

Legacy timeline-less queue entries and Community/AI intents remain unverified
and preserved for review. After a restore, old operations pause and read caches
invalidate. The recovery notice provides selected local discard with confirmation;
review current state and re-enter desired work as a new action. Old AI clears
never execute in a new timeline. Cross-tab advertisements, owner locks and request
context checks stop stale writes and late responses.

See ../CLIENT_RECOVERY.md for cache classification and migration semantics and
../RELEASE_COMPATIBILITY.md for staged rollout. Flutter remains protocol 1 until
10D; server ALLOW_LEGACY remains transitional. Full restore safety/production
release is not established until later phases and independent operator approval.
