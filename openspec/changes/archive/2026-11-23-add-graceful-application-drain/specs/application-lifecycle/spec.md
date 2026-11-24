## ADDED Requirements

### Requirement: Irreversible startup-safe process drain

Each API, collaboration and worker process SHALL implement STARTING, RUNNING, DRAINING and terminal STOPPED or FAILED states. A SIGTERM or SIGINT SHALL synchronously enter DRAINING, stop new business admissions and readiness, and start one shutdown promise with one absolute monotonic deadline of 120 seconds by default. STARTING MAY transition directly to DRAINING. Repeated signals SHALL NOT restart cleanup or extend the deadline. Signal/fatal handling SHALL be installed before asynchronous startup. A startup result arriving after cutoff SHALL be settled and closed without starting new listeners, claims or readiness. Fatal errors SHALL initiate failure cleanup and SHALL NOT resume normal operation or exit successfully.

#### Scenario: Signal interrupts asynchronous startup

- **WHEN** SIGTERM arrives while storage initialization or LISTEN startup is pending
- **THEN** readiness is false immediately, the startup work remains accounted for, and its eventual completion cannot start listeners or claim loops

#### Scenario: Repeated signals share the first deadline

- **WHEN** SIGTERM then SIGINT arrive during a drain
- **THEN** only one shutdown executes and both share the first cutoff and deadline

#### Scenario: Fatal error during normal operation

- **WHEN** an uncaught exception or unhandled rejection occurs
- **THEN** business admission stops, bounded failure cleanup begins and successful drain evidence is prohibited

### Requirement: Local admission enforcement and non-sensitive probes

While a probe listener remains available, `GET /health` SHALL report process liveness without requiring DB or S3 and existing API health behavior SHALL remain 200 with `{ "status": "ok" }`. `GET /ready` SHALL return 200 `{ "ready": true }` only in RUNNING and 503 `{ "ready": false }` otherwise, with Cache-Control no-store and no identifiers or diagnostics. Equivalent role probes SHALL use existing role HTTP ports, including worker when metrics are disabled. Probes SHALL NOT control lifecycle. After cutoff new business HTTP requests, including keep-alive and pipelined requests, SHALL receive 503, Retry-After 1, Connection close, Cache-Control no-store and a generic service_unavailable error in the existing envelope before business auth/parsing/storage side effects. Configured-origin CORS behavior SHALL remain valid. New WebSocket upgrades/admissions SHALL be denied; a pending pre-cutoff authorization SHALL NOT register a socket after cutoff.

#### Scenario: Request arrives over an existing connection

- **WHEN** a client sends another business request on an existing keep-alive connection after cutoff
- **THEN** it receives the drain 503 headers and no business operation starts

#### Scenario: Probes during drain

- **WHEN** a client reads probes while the draining process still serves its probe listener
- **THEN** health remains live, ready returns false with 503 and no instance, operation or user identifiers are exposed

#### Scenario: Upgrade authorization overlaps cutoff

- **WHEN** a WebSocket authorization starts before cutoff and returns afterward
- **THEN** it is awaited, its transaction is settled and it cannot register a new socket; a later upgrade receives HTTP 503 with Retry-After and connection closure

### Requirement: Work ownership precedes asynchronous effects

Every startup, admitted HTTP handler, stream, upgrade authorization, message/notification callback, background claim/schedule/backfill and required subordinate effect SHALL be tracked before its first asynchronous authorization, resource acquisition or side effect. Ownership SHALL continue until service/stream completion, required S3 effects, transaction commit or rollback, compensation and temporary cleanup are settled. Client disconnection, response finish, socket closure and a timeout race SHALL NOT alone release ownership. Thread-live sockets, close callbacks, pending work, timers, LISTEN and reconnect tasks SHALL settle before their shared dependencies close.

#### Scenario: Upload client disconnects

- **WHEN** a client disconnects while its admitted upload continues an S3 write and database settlement
- **THEN** drain continues tracking the operation through confirmed settlement or explicit failure, rather than counting the disconnect as completion

#### Scenario: Claim result arrives after cutoff

- **WHEN** a tracked SQL claim started before cutoff returns ownership after cutoff
- **THEN** the acquired attempt remains owned through its fenced outcome and no next claim starts

#### Scenario: Thread callback is still using the pool

- **WHEN** thread-live socket close or notification handling still has a pending database callback
- **THEN** pool closure waits for that callback and no retry timer can reopen LISTEN

### Requirement: Confirmed settlement and ordered resource closure

A successful drain SHALL require confirmed required durability and cleanup for all admitted owners, no unresolved external-effect uncertainty or ownership loss, closed role transports/listeners and callbacks, and shared PostgreSQL pools, S3 clients and observability closed after their users. Expected business failures and confirmed durable retries MAY settle normally when no effect remains uncertain. Swallowed exceptions, rejected allSettled members, zero-row fenced outcomes and uncertain commits SHALL NOT be treated as clean settlement. Deadline expiry SHALL latch FAILED, cancel/force-close remaining work best-effort within the original budget and SHALL NOT become success after later cleanup. All phases including evidence publication SHALL fit within the same deadline, with bounded forced exit if cleanup or evidence hangs.

#### Scenario: Required resource close fails

- **WHEN** a required listener, storage, pool or observability closure fails
- **THEN** successful evidence is prohibited even if active business work reached zero

#### Scenario: Deadline occurs during forced cleanup

- **WHEN** remaining work or finalization exhausts the absolute deadline
- **THEN** the process exits 2 with timeout failure, no renewed grace period and no later success classification

#### Scenario: Confirmed durable retry

- **WHEN** a known failed operation commits its documented retry outcome with verified ownership and all local execution has stopped
- **THEN** that attempt can settle without requiring the unclaimed queue to be empty

### Requirement: Durable boot-bound evidence and exits

A configured process SHALL publish an atomic flushed local boot identity descriptor and terminal receipt on host-mounted storage separate from DB/S3 and log spool. Receipts SHALL include schema version, role, unique boot identity, immutable release/image identity, nullable operation/request identity, signal/trigger, timing/deadline, result/exit code, fixed-key remaining counts and bounded sanitized failure codes; they SHALL exclude PII, business identifiers, payloads, credentials, raw SQL/errors and object keys. Publication SHALL write and fsync a same-directory temporary file, atomically rename and fsync the directory, with restrictive permissions and no overwriting another boot. Success SHALL be published only after required closure and no unresolved work. Exit 0 SHALL require successful publication; other failure SHALL exit 1, deadline expiry SHALL exit 2. Evidence errors SHALL never be ignored or converted to exit 0.

#### Scenario: Directory sync fails after rename

- **WHEN** receipt rename succeeds but the required directory flush fails
- **THEN** the process exits nonzero and any visible success receipt cannot satisfy replacement

#### Scenario: Evidence publication hangs

- **WHEN** a filesystem operation does not settle before the deadline
- **THEN** the process exits 2 even if no receipt can be published, and replacement remains blocked

#### Scenario: Receipt redaction

- **WHEN** a storage error includes a document ID, key or credential-bearing message
- **THEN** evidence contains only an allowlisted sanitized code and bounded aggregate counts

### Requirement: Operation binding without writer relabel restarts

A replacement operation SHALL bind to an already-running boot by atomically staging a private bounded strict request file in a mounted read-only request directory before SIGTERM. After synchronous cutoff the process SHALL read that request once, validate regular-file/no-symlink access, schema, operation UUID, single-use nonce and exact role/boot/immutable-release/image identity, and echo the validated tuple in its terminal receipt. A missing request SHALL allow ordinary shutdown with null operation identity but SHALL NOT satisfy replacement; a present malformed, unreadable or mismatched request SHALL fail evidence. No application restart solely to attach an operation label, hot-poll watcher or admin endpoint SHALL be required.

#### Scenario: Later replacement labels an existing boot

- **WHEN** an operator stages an exact boot-bound operation request and then sends SIGTERM
- **THEN** that same boot drains and publishes evidence bound to the request without a writer restart

#### Scenario: Request is absent or arrives too late

- **WHEN** the single drain-time read finds no request
- **THEN** ordinary shutdown evidence has null operation identity and cannot later be rebound to a replacement

#### Scenario: Request targets another boot

- **WHEN** a present request contains another boot, role, release, image or invalid nonce
- **THEN** the process cannot publish successful replacement evidence

### Requirement: Replacement evidence is a complete matching set plus observed exits

Replacement SHALL remain blocked until a consumer verifies a successful, zero-remaining-work receipt for every inventoried writer process with exact operation/nonce/role/boot/immutable release/image and host-observed container identity, plus observed exit 0 after cutoff. OOM, KILL, signal termination, restart/change of boot, missing/partial/malformed/stale/duplicate/mismatched evidence, unobserved exit and nonzero exit SHALL reject. Receipts SHALL be collected before container removal, and writer inventory/holds SHALL remain valid through capture and activation. Container grace SHALL be at least 150 seconds for the default 120-second application deadline. Application evidence SHALL NOT substitute for operator inventory and fencing of external dashboard/script/other-deployment DB/S3 writers.

#### Scenario: Success receipt but abnormal termination

- **WHEN** one inventoried container has a success receipt but exits nonzero, is OOM killed or restarts
- **THEN** replacement is refused

#### Scenario: All expected roles with observed clean exits

- **WHEN** every inventoried boot has a matching successful receipt and observed exit 0, no unexpected writer has appeared and external writers remain fenced
- **THEN** application-drain evidence is satisfied without claiming to prove external writer fencing itself

#### Scenario: Stale proof or missing role

- **WHEN** a receipt belongs to an older operation/boot/release or any inventoried API, collaboration or worker instance lacks proof
- **THEN** replacement remains blocked despite any other clean exits

#### Scenario: Whole-millisecond wire duration

- **WHEN** the monotonic drain duration has a fractional millisecond component
- **THEN** the v1 terminal receipt serializes elapsedMs as a nonnegative integer by flooring, while success/deadline enforcement uses the full-precision measurement

#### Scenario: Historical writer predates the lifecycle producer

- **WHEN** an inventoried historical release lacks the exact v1 producer, mounts or immutable identity configuration
- **THEN** it remains ineligible for online graceful-drain replacement, even after exit0 or SSHtimeout; a normal lifecycle-capable deployment must precede a later replacement, which must not implicitly upgrade/rebuild a differentSHA to manufacture receipts
