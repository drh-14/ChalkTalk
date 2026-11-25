# Application lifecycle

API, collaboration and worker processes have an irreversible
`STARTING -> RUNNING -> DRAINING -> STOPPED/FAILED` lifecycle. Signal and fatal
handlers are installed before asynchronous startup. SIGTERM/SIGINT synchronously
stop new HTTP, WebSocket/edit, claim, schedule and backfill admissions. An admitted
operation stays owned through service, stream, S3, transaction/rollback,
compensation, temporary cleanup and subordinate worker/child completion; closing
its browser socket or HTTP response is not settlement. Startup returning after
cutoff cannot make the process ready or start another listener/claim loop.

## Probes and late HTTP

On each role's configured `PORT` (default 3000), while its listener exists:

| Request       | Response                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `GET /health` | 200 `{"status":"ok"}`; liveness only; no DB/S3 access                                            |
| `GET /ready`  | 200 `{"ready":true}` only in RUNNING; otherwise 503 `{"ready":false}`; `Cache-Control: no-store` |

Probes are identifier-free and read-only, not lifecycle controls or drain proof.
Once transport closure starts, they can become unreachable. Worker probes remain
available when metrics are disabled. `/ready` is not a replacement safety fence.

After cutoff, new business HTTP requests (including keep-alive/pipelined and
OPTIONS) receive 503 before parsers/authentication/storage, using the existing
error envelope with `code: service_unavailable`, a generic message, requestId and
empty details. Headers: `Retry-After: 1`, `Connection: close`, `Cache-Control:
no-store`. An exact configured Origin retains credentialed CORS; no wildcard.
New WebSocket upgrades receive HTTP 503 with Retry-After and connection closure.
Pending authorization cannot register a socket after cutoff.

## Settlement and deadline

The default is one absolute monotonic **120000 ms** budget, shared by all phases,
including evidence IO. Repeated/reentrant signals join the original promise and
never extend it. Graceful claim stop does not cancel active extraction: heartbeats
and children remain owned. At expiry force cancellation is attempted and the
process exits **2**, never later success. Other unresolved failures/uncertainty,
required closure or evidence errors produce exit **1**. Clean drain is exit **0**
only after confirmed owner settlement, required final persistence, transport/
callback closure, shared S3/PG and observability closure, and durable publication.

A known failed business operation may settle through a confirmed fenced durable
retry. A lost lease/zero-row fenced update, uncertain provider acceptance or
accepted send with unconfirmed commit is not clean merely because a retry row
exists. Shutdown does not reset leases/decrement attempts to manufacture success.

## Evidence producer contract, schemaVersion 1

Production configuration requires all of:

- `LIFECYCLE_EVIDENCE_DIRECTORY` (private host-mounted writable directory)
- `LIFECYCLE_REQUEST_DIRECTORY` (separate private read-only request mount)
- `LIFECYCLE_RELEASE_ID` (immutable deployed release, bounded opaque ASCII ID)
- `LIFECYCLE_IMAGE_DIGEST` (`sha256:` plus 64 lowercase hex; per-role inspected ID)

Unconfigured non-production runs use a unique local temporary evidence directory,
`local-development` release and zero image digest. This is not production
replacement proof. Partially configured identity is rejected; configured IO
failure is never ignored. Production sample placeholders must be replaced before
startup. See [host integration](../../deployment/production/LIFECYCLE.md).

Each boot generates one random UUID and atomically publishes
`BOOT_UUID.boot.json` before becoming ready. Fields: `schemaVersion`, `role`
(`api|collaboration|worker`), `bootId`, `releaseId`, `imageDigest`, `bootStartedAt`.
The host independently binds that descriptor to inspected container ID, image,
start and restart count; mutable tags or self-report alone are insufficient.

Stage `BOOT_UUID.json` atomically, privately (0600, readable by the writer UID)
in the request mount **before SIGTERM**. Exactly these JSON fields are accepted:

```json
{
  "schemaVersion": 1,
  "operationId": "11111111-1111-4111-8111-111111111111",
  "requestNonce": "22222222-2222-4222-8222-222222222222",
  "role": "api",
  "bootId": "33333333-3333-4333-8333-333333333333",
  "releaseId": "immutable-deployed-release",
  "imageDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

Operation/boot/nonce are UUIDs; all identity fields must exactly match that boot.
The file is read once after cutoff; late staging cannot rebind it. Maximum 8192
bytes, regular file, no symlink file or directory, no group/other permissions,
strict fields/schema. Missing request allows ordinary shutdown with null
operationId/requestNonce; malformed/unreadable/mismatched present requests fail.
No hot watch, admin endpoint, operation relabel or restart is used.

`BOOT_UUID.terminal.json` includes the descriptor identity, nullable
`operationId`/`requestNonce`, `trigger`, `cutoffAt`, `completedAt`, `deadlineMs`,
`elapsedMs`, `result` (`success|failure|timeout`), `exitCode`, fixed-key `remaining`
(`activeAdmissions`, `handlers`, `stores`, `jobs`, `heartbeats`, `children`,
`listeners`, `unresolved`) and bounded allowlisted `failures`. No business IDs,
payloads, credentials, paths, raw errors/SQL or object keys are serialized.

Publication exclusively reserves a boot-specific filename, creates a 0600
same-directory temporary file, writes/fsyncs/closes it, atomically renames it and
fsyncs/closes the directory. Reservations and temporary files are never proof.
A directory-sync failure can leave a visible success receipt but must exit
nonzero. Hung IO can leave no receipt and exits 2 at the same absolute deadline.

## Consumer boundary (owned by replacement integration)

Require every inventoried writer boot's exact operation/nonce/role/boot/release/
image tuple, success/zero remaining counts, elapsed within deadline **and observed
exit0**. Collect before removal. Reject missing roles/files/exits, malformed,
partial, stale, mismatched or duplicate evidence; wrong container, changed boot,
restart, OOM/KILL, signal/nonzero exit and zero-exit-without-receipt. Ordinary
unbound shutdown cannot satisfy replacement. A receipt cannot prove its future
exit. Keep inventory/holds valid through capture and activation, and independently
fence external dashboard/script/other-deployment DB/S3 writers. Lifecycle evidence
is not an activation control plane or proof of external fencing. Dependent
consumer compatibility/negative checks are mandatory before unblocking replacement.

When running roles directly on one host, give the worker a distinct `PORT`; the
root `npm run dev` command uses 3002 for the worker. Containers retain their
existing per-container 3000 metrics/probe port.

`elapsedMs` on the v1 wire is a nonnegative whole number of milliseconds
(floored from the monotonic measurement). Deadline enforcement and success checks
use the full-precision measurement, not the rounded serialization.

A historically deployed release that predates the v1 producer, mounts or immutable
identity configuration is ineligible for online graceful-drain replacement. Deploy
a drain-capable release through the normal deployment flow first; a later VM or
Supabase replacement must never upgrade/rebuild another SHA just to manufacture
receipts. Exit 0 or SSH timeout cannot substitute for missing evidence. Offline
positive fencing and backup recovery are separate scope, not fabricated receipts.
