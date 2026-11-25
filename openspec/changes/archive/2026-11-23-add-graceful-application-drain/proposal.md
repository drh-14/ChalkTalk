## Why

Supabase replacement must not capture or activate from an application shutdown that silently lost admitted work or live collaboration edits. Current API, collaboration and worker entrypoints do not provide a common, bounded drain or trustworthy instance-specific completion evidence.

## What Changes

- Add a SIGTERM/SIGINT lifecycle shared by the API, collaboration and worker processes: irreversible admission cutoff, 120-second absolute deadline, owner settlement, ordered closure, failure-aware exits and local durable receipts.
- Preserve `/health` liveness; add identifier-free read-only `/ready`. Reject late HTTP/keep-alive and WebSocket admissions while finishing admitted work, including storage and database settlement.
- Freeze collaboration edits and confirm the final frozen document save before destruction without ending user sessions or introducing per-edit acknowledgements.
- Separate worker stop-claiming from active cancellation, retaining heartbeats and subprocess ownership until committed job/digest/backfill outcomes settle.
- Define replacement evidence as every inventoried boot's matching successful receipt plus observed exit 0, never a Docker stop result or operator assertion alone.
- Bind operations through the approved private host-staged boot-bound request file before SIGTERM, read once after cutoff with exact boot/release/image/nonce validation; no writer relabel restart, watcher or admin endpoint. Shared deployment ownership remains an explicit parent assignment, not an assumed application responsibility.

## Capabilities

### New Capabilities

- `application-lifecycle`: startup-safe irreversible drain, HTTP/WebSocket admissions, owner/resource settlement, fatal/deadline semantics and durable replacement evidence.

### Modified Capabilities

- `course-collaboration-sessions`: shutdown cutoff and confirmed frozen document persistence, separate from user session ending.
- `daily-course-email-digest`: drain scheduling and delivery through durable, ownership-checked outcomes without claiming exactly-once email.
- `resource-text-search`: stop extraction claims without prematurely cancelling active extraction or losing heartbeat/child ownership.

## Impact

Separate prerequisite lifecycle PR; implementation is not authorized by this planning artifact. Scope: `apps/api/src/lifecycle/` (new), entrypoints, HTTP/thread-live, collaboration transport/server, jobs/digest/extraction and necessary existing storage/semantic adapters; specifications, API references, tests and eventual verification. No new dependency, database migration, admin endpoint, control plane, per-edit acknowledgement protocol or production execution.

Shared production Compose/mount/identity/grace integration must have an explicitly agreed owner before edits: security `90927` owns bootstrap/deploy/holds, not implicitly application work. VM `cdeee230` and Supabase `70d3` retain separate namespaces. Supabase replacement stays blocked until lifecycle implementation and evidence validation exist. The paused handoff guide is not edited. External database/object-store writers remain operator-fenced and are outside application receipt coverage.
