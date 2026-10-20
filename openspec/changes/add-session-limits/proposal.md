# Proposal

## Why

Three operational gaps from the live session follow-ups list (items 3, 4, and 10):

- **Idle sessions stay active indefinitely.** A session nobody ends keeps appearing in active lists and keeps its post's **Live session active** link.
- **No per-user limits.** A user can create sessions and request connection tickets without bound. Logins and signups are already rate limited.
- **No collaboration server metrics.** The API and worker report to the existing Prometheus and Grafana stack; the collaboration server reports nothing, so connection counts, store latency, and revocations are invisible.

## What Changes

- **Idle sessions end themselves.** A session with nobody connected for a configurable period (`COLLABORATION_IDLE_END_MINUTES`, default 120) ends as if its creator had ended it: it becomes read-only and keeps its final code and whiteboard. The collaboration server's existing sweep records when each session last had someone connected, in a new `collaboration_sessions.last_active_at` column, and ends idle sessions.
- **Rate limits.** Creating sessions is limited per user (`RATE_LIMIT_COLLABORATION_CREATE_USER`, default 30 per hour). Requesting connection tickets is limited per user (`RATE_LIMIT_COLLABORATION_TICKET_USER`, default 300 per 10 minutes, which covers reconnects). Over the limit, the API returns `429 rate_limited` with `Retry-After`, like the existing limits. The web app shows the message.
- **Metrics.** When observability is enabled, the collaboration server serves `/metrics` on its own port behind the same bearer token as the API and worker. It reports connected clients, loaded documents, store duration, rejected updates, revocations by reason, and sessions ended by reason. Prometheus scrapes it, and the Grafana dashboard gains a live sessions row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-code-sessions`: idle sessions end automatically; creation and tickets are rate limited; the collaboration server reports metrics.

## Impact

- **Database:** migration `022_collaboration_last_active.sql` adds `collaboration_sessions.last_active_at`.
- **Collaboration server:** idle tracking and ending in the sweep; a metrics registry and `/metrics` route.
- **API:** rate limits on `POST /courses/{courseId}/collaboration-sessions` and `POST /collaboration-sessions/{id}/connection-tickets`; three new environment variables.
- **Ops:** the Prometheus scrape target, the Grafana dashboard, `.env.example`, and the observability smoke script.
- **Docs:** the 429 responses in `collaboration-sessions.md` and `openapi.yaml`, idle ending in `collaboration-websocket.md`, and the column in `database.md`.
- **Coordination:** stacked on `add-session-invitations`.
