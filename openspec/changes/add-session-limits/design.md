# Design

## Context

- **Sweep.** The collaboration server sweeps every 15 seconds (`sweepIntervalMs`) to recheck connection authorization. It is a single process, and the existing design does not support several collaboration nodes.
- **Ending.** Lifecycle-driven ends (`endCollaborationSessions`) set `lifecycle_state='ended'` and send the `session_ended` event. The server answers that event by persisting, broadcasting `session-ended`, and closing connections.
- **Rate limits.** `rate_limit_buckets` holds fixed-window counters keyed by action, subject, and window start. `AuthService.limit` uses it for login and signup; an `AuthError` with `retryAfter` becomes a `Retry-After` header.
- **Metrics.** The API and worker use `prom-client` registries from `createObservability`, guarded by `METRICS_TOKEN`. Prometheus scrapes `api:3000` and `worker:3000`.

## Decisions

### D1. `last_active_at` maintained by the sweep

Migration 022 adds `collaboration_sessions.last_active_at timestamptz NOT NULL DEFAULT now()` and backfills it from `updated_at`. The collaboration server sets it:

- to now for every session with at least one connection, on each sweep (one `UPDATE … WHERE id = ANY($1)`);
- to now when a connection authenticates;
- to now when the last connection to a document closes.

So `last_active_at` lags reality by at most one sweep interval while anyone is connected.

### D2. Idle ending in the same sweep

After touching connected sessions, the sweep runs:

```sql
UPDATE collaboration_sessions
SET lifecycle_state='ended', ended_at=clock_timestamp(), version=version+1, updated_at=clock_timestamp()
WHERE lifecycle_state='active'
  AND last_active_at < now() - make_interval(mins => $1)
  AND NOT (id = ANY($2))
RETURNING id
```

`$2` is the sessions this server has connections for. It sends `session_ended` for each, reusing the lifecycle path, which persists any loaded document and closes nothing, since nobody is connected. Sessions in `ending` are left to the end handshake. The idle period comes from `COLLABORATION_IDLE_END_MINUTES` (1 to 10,080, default 120). Each ended session increments `sessions_ended_total{reason="idle"}`.

*Alternative:* the job worker could end idle sessions. Only the collaboration server knows who is connected, so the worker would need the same `last_active_at` and could still race a connection that is opening.

### D3. A shared fixed-window limiter

`apps/api/src/database/rate-limit.ts` exports `consumeRateLimit(db, action, subject, limit, windowSeconds)`, the same SQL as `AuthService.limit` without hashing, since subjects are user IDs. `AuthService` is unchanged.

- **Create.** `CollaborationSessionService.create` consumes `collaboration-create:<userId>` (3,600-second window) only when it is not replaying an idempotency record.
- **Tickets.** `CollaborationSessionService.ticket` consumes `collaboration-ticket:<userId>` (600-second window) before issuing a ticket.

Limits come from `RATE_LIMIT_COLLABORATION_CREATE_USER` and `RATE_LIMIT_COLLABORATION_TICKET_USER` through the service's options. Each limit runs in the request's transaction, so a limited request changes nothing else.

### D4. Collaboration metrics on the Hocuspocus port

`createCollaborationServer` takes an optional observability token. When it is set, the server builds its own `prom-client` registry with default process metrics and the series in the spec, and answers `GET /metrics` in Hocuspocus's `onRequest` hook, comparing the bearer token in constant time, as `createObservability` does. Gauges are computed at scrape time from `hocuspocus.documents`. `persist` times stores, `beforeSync` rejections increment `rejected_updates_total`, and every server-initiated close increments `closes_total{reason}`.

Prometheus gains the job `chalktalk-collaboration` → `collaboration:3100`. The API dashboard gains a "Live sessions" row with connections, documents, store latency p95, and closes by reason. `docker/test-observability.sh` checks the endpoint's token handling.

## Risks / Trade-offs

- [Clock skew between the collaboration server and Postgres] → All times come from Postgres `now()`.
- [A session connected only on a crashed server] → After a restart nobody is connected, so it ends once idle, which is the intended outcome.
- [Rate limits that are too strict for a busy TA] → The defaults are generous, and environment variables can raise them.

## Migration Plan

Deploy migration 022 (an added column with a default), then the API and collaboration server. Rolling back the code leaves an unused column.
