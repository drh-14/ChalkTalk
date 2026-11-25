# Current implementation progress — 2026-11-23

This section supersedes the historical foundation-only checkpoint retained below.
Application entrypoints, HTTP handler/parser/stream ownership, thread-live callbacks,
frozen collaboration persistence, worker/digest/heartbeat/extraction ownership,
read-only probes, durable boot-bound evidence and minimal Compose/host setup are
implemented. Shared bootstrap/deploy callsites and other replacement namespaces
are untouched. The user approved the narrow reconnect behavior correction before
its OpenSpec/code edits; no styling was changed.

Verification includes real process signals/startup races/deadlines and filesystem
faults; real HTTP/WS; isolated disposable PG/S3; actual extraction child shutdown;
fake-email acceptance/unknown-commit and confirmed retry; Linux bind ownership,
read-only requests and fsync persistence; frontend unit and real mocked-API browser
reconnect/503/thread subscriptions. Browser screenshots are ignored artifacts under
`documentation/browser-screenshots/lifecycle/` and have been visually inspected.

Full run7 passed 2020 tests with45skipped (163 files passed,3skipped). Required local PG/S3 suites ran. Six Linux acceptance tests, actual consumer wire check, lint/typecheck/format/build and strict OpenSpec validation passed. Final gate, archive, one-commit draft PR publication and exact-head CI remain pending. Earlier full-suite
runs exposed obsolete process-port/cancellation mocks and a never-settled query
mock, now corrected. Query timeout preserves prompt authorization rejection while
retaining actual SQL ownership; notification failures retain sibling callbacks.
Do not infer full verification from focused green tests.

Supabase70d3 acknowledged wire compatibility through the parent. Synthetic
positive and explicit negative fixtures are in
`tests/fixtures/lifecycle-replacement-evidence.json`. Its consumer checks, external
writer fences and live integration remain unverified; replacement/activation stay
blocked. The setup/identity callsite patch is documented in
`deployment/production/LIFECYCLE.md`, not applied to security-owned files.

The no-mistakes home and notification overrides are isolated under
`/tmp/chalktalk-lifecycle-gate-537a30aa`, with process/worktree-only Git URL mapping.
The shared gate run/global settings remain untouched. No gate run, commit or PR has
yet been created. Parent retains watch responsibility.

## Additional verification before gate

Six Linux acceptance tests passed. Actual non-root Docker API/API/collaboration/worker receipts with independently inspected image IDs and observed exit0 passed the separately owned Supabase consumer; all30mutated actual-wire cases rejected and captureAuthorized remained false. An integer elapsedMs wire mismatch was reproduced and fixed without rounding deadline enforcement. A macOS IPv6wildcard/IPv4port collision explained the scattered HTTP regression failures; the test-only client now matches the fixture address family, with a red/green public listener regression. A fresh full suite (run7) is running. The preliminary explicit-host test bind was rejected because it makes Node listen asynchronous; the final Supertest public serverAddress adapter changes only the client address family, with controlled collision/family red-green tests. No listener bindings change. VM reported4compatible tests, Supabase54; those are separate owner reports, not live proof. Historical pre-v1 deployments remain ineligible; normal deployment must precede future replacement.

---

## Historical foundation checkpoint (superseded, preserved for history)

# Implementation checkpoint — 2026-11-23

## Custody and scope

Implementation is authorized by the explicit implementation assignment, superseding the planning-only restrictions in the original proposal/tasks prose. Existing proposal/design/spec/tasks content is preserved. No unchecked task is claimed complete on the strength of partial work.

- Existing isolated planning worktree and exclusive `t3/plan-lifecycle-prerequisite` retained.
- Fetched `origin/main`: `31b9ab74a4009187b677b8ff0bc0bca9921fdc93`, equal to HEAD; no branch realignment, reset, rebase, squash, commit or push performed.
- Original planning history archive remains untouched. No sibling changes imported.
- Only new lifecycle module/tests, child-process fixture, and this checkpoint added. Shared Compose/bootstrap/deploy files, paused guide and other owners' namespaces untouched.
- Project lockfile install used `npm ci --ignore-scripts`; manifests/lockfile unchanged. No new or global dependencies.

## Implemented but NOT integrated

New lifecycle runtime: STARTING/RUNNING/DRAINING/STOPPED/FAILED, synchronous irreversible admission cutoff, startup ownership, idempotent leases, guarded RUNNING, reentrant/repeated shutdown promise, default 120000ms deadline, separate stop-admission/force-cancel signals, ordered transport/dependency/observability closure, sticky failure and deadline exits. Process signal/fatal handler installer provided but not yet installed in application entrypoints.

New evidence producer: random boot UUID; bounded identity; strict read-once post-cutoff request interface; regular-file/no-follow/private-mode/bounded-size validation; exact role/boot/release/image/operation/nonce binding; ordinary missing request remains unbound; atomic same-directory write/file-fsync/rename/directory-fsync with mode 0600 and exclusive publication reservation; immutable boot-specific descriptor/terminal paths. Required IO failures propagate. Success serialization rejects outstanding work/failures/deadline overrun. No business/error payloads serialized.

This code alone does not make any deployed writer drain-capable. Application entrypoints, HTTP/WS/collaboration/jobs/digest/extraction and configuration still require adapters and verification. Replacement remains blocked.

## Tests and evidence

Focused public runtime, actual child OS-signal/observed-exit, real temporary-filesystem and IO fault suites are in `apps/api/src/lifecycle/`. Red runs recorded during development for missing runtime, missing signal installer, missing evidence producer, unsafe outstanding-work success, and symlinked request-directory acceptance; then corresponding green runs.

Coverage includes startup cutoff/late RUNNING denial; repeated and reentrant signals; original deadline; fatal rejection; dependency-close error; timeout that cannot become success after cancellation; hung publication/file write; ordinary missing binding and late staging; exact tuple; malformed/partial/extra/mismatched/oversized/symlink requests; create/write/fsync/rename/directory-sync/close failure. Real child/disk test demonstrates visible success file plus observed exit1 after directory flush failure: receipt alone is never replacement proof.

The focused suite passed 35 tests before this checkpoint. API TypeScript no-emit check, focused ESLint, Prettier, strict OpenSpec validation and diff whitespace check passed. These are NOT full application, Linux bind-mount or gate/CI verification.

## Minimum shared integration interface (not assigned; do not edit shared files)

- One process per inventoried container; role `api`, `collaboration` or `worker`.
- Private host-provisioned read-only request directory and separate writable durable evidence directory. Proposed mount targets remain `/run/chalktalk-lifecycle/requests` and `/var/lib/chalktalk-lifecycle/evidence` from the approved design; security/parent must confirm host paths, readable writer UID and restrictive permissions.
- Evidence filename `<bootId>.boot.json` then `<bootId>.terminal.json`; internal exclusive `.reserved` files and temporary files are not consumer proof.
- Request filename `<bootId>.json`, strict JSON keys: `schemaVersion:1`, `role`, `bootId`, `releaseId`, `imageDigest`, `operationId`, `requestNonce`. UUID operation/nonce; exact identity match. Stage atomically before SIGTERM. Current producer requires request mode with no group/other permissions (e.g. 0600), readable by writer UID.
- Immutable release identity (bounded opaque ASCII identifier) and image digest (`sha256:` plus 64 lowercase hex) must come from trusted deployment plumbing, not a mutable image tag. Environment variable names/configuration are not implemented/finalized yet.
- `stop_grace_period >=150s`; direct SIGTERM delivery. No watcher/admin endpoint/relabel restart.
- Host inventory must map descriptor to inspected container/image/start/restart identity. Consumer must require matching operation/nonce and every inventoried boot's terminal success/zero counts plus observed exit0. Supabase owns that verifier and external fences; consumer compatibility is not yet agreed or tested.

## Delivery and remaining work

No OpenSpec archive, feature commit, draft PR, screenshot upload, publication or final CI exists. All task groups remain open except the original approval item. Next work is entrypoint/configuration and API admission/actual handler settlement adapters, followed by thread-live, collaboration freeze/persistence, jobs/digest/extraction ownership, isolated PG/S3 faults, browser reconnect scenarios, documentation and integration tests.

The shared no-mistakes gate is registered and `doctor` reports Codex runnable. Another branch has an active gate; it was left untouched. Isolated notify=[] setup remains unresolved; do not start a run with shared/global settings changes or claim a gate pass. Full gate, one-commit draft delivery and final-head CI remain mandatory after implementation. Parent retains PR watch responsibility.
