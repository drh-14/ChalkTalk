## Why

ChalkTalk's current Compose stack is for local development: it mounts source, serves Vite, seeds mock data, and uses Mailpit. A single-VM course deployment needs a separate, repeatable release topology without changing that workflow.

## What Changes

- Add a runnable `deployment/` Compose stack with Caddy HTTPS, compiled web/API/worker/collaboration services, one-shot migrations, PostgreSQL 17, and SeaweedFS.
- Configure same-origin API and WebSocket routing, AWS SES SMTP, private application/database/storage networks, persistent data volumes, bounded logs, and health-gated startup.
- Add an opt-in one-hop trusted-proxy setting for the internal API, so per-IP limits use the client address forwarded by the sole public Caddy proxy.
- Document pinned-commit builds and required environment variables. Backup automation and architecture diagrams are deferred.

## Capabilities

### New Capabilities

- `single-vm-deployment`: A standalone production-oriented Compose skeleton for a single Linux VM.

### Modified Capabilities

- `authentication`: An explicitly enabled, one-hop trusted reverse proxy supplies the client IP used by per-IP rate limits.

## Impact

New deployment files; narrow API environment/app changes and tests. Local development Compose remains unchanged. This skeleton is not production-ready without off-host backups and a live deployment smoke test.
