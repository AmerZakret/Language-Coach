# Browser queue and session coordination

Queue writes use `linguaai:queue:storage:<encoded owner>`; drains use a separate
`linguaai:queue:drain:<encoded owner>`. Both are origin-scoped exclusive Web Locks.
Drain callbacks may acquire storage locks; storage callbacks never acquire a
drain lock. Storage callbacks are synchronous, reload the latest record, and
commit the owner queue once, including mappings, retry and quarantine metadata.
Network waits hold only the drain lock. Document teardown releases browser locks;
unacknowledged requests retry with their original action ID and epoch.

The atomic `linguaai_session_v1` record contains the user (including target
language), token, guest type and revision. Conditional auth updates and legacy
migration use `linguaai:auth:session`. A legacy token is initially unowned and may
only call `/users/me`; its separately saved user is never trusted as the owner.
Queues and caches remain stored across logout or account switches.

Storage events notify other tabs of auth and current-owner queue/cache changes.
Notifications refresh/wake subscribers; they provide no exclusion. Requests pin
the session committed with the UI before entering Axios, and revalidate at
dispatch. A new session revision remounts the UI subtree, clearing old drafts.

Serve over HTTPS (localhost also supports secure-context APIs). The application
has no declared older-browser baseline. Without `navigator.locks`, queue/progress
storage mutations, local guest card mutations, and drains fail closed, even in a
single tab. Existing work remains readable. Explicit auth replacement is one
atomic write and direct online requests still validate their captured session.
Conditional async auth writes and legacy migration stop; sign in again to install
an explicit session. A 401 invalidates only the affected tab in memory, without
racing another tab's persisted login. There is no localStorage lease fallback.

Deployment must reload/close every older application tab: old code that does not
participate in these locks cannot be made safe by new code taking a lock. Locks
coordinate tabs/windows/workers in one storage partition, not other devices.
Local guest flashcards store one authoritative all-card snapshot; due cards are
derived, and legacy due-only caches remain readable. Backend card caches remain
rebuildable views of server and owner queue state.

Run `node --test test/*.test.cjs` from the web directory. The multi-context suite
executes production storage/session/queue modules in independent VMs sharing an
origin, asynchronous storage events and a browser-lock model. Document closure
and transport interruption are simulated; no real browser driver is installed.
