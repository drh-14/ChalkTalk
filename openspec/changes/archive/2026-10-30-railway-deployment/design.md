## Context

The current `deployment/` stack is single-VM Compose with Caddy-managed TLS, PostgreSQL and SeaweedFS containers, and SES SMTP. Railway will terminate public TLS and schedule services separately. The browser expects same-origin `/api/*` and `/collaboration` paths.

## Decisions

- Build separate `deployment/Dockerfile` (app) and `deployment/Dockerfile.web` (gateway) from a pinned commit because Railway does not expose a documented multi-stage target setting. `web` uses Caddy on plain HTTP `${PORT}`, serves compiled React assets, and routes API and WebSocket traffic over Railway private DNS.
- Use only one public domain on `web`. API `:3000`, collaboration `:3100`, worker, PostgreSQL, and SeaweedFS `:8333` are private. SeaweedFS has a persistent `/data` volume; PostgreSQL uses Railway's managed service.
- Let Railway edge set `X-Real-IP`; Caddy discards caller `X-Forwarded-*` values and sends only the edge client IP to Express. Verify this against the actual Railway edge before production use.
- Run the compiled migrator once as an explicit release gate. Do not enable concurrent pre-deploy migrations on API/worker/collaboration.
- Use Resend HTTPS in API and worker; Mailpit remains local only. Keep no VM Compose or automatic SMTP fallback in production.

## Risks and mitigations

- Manual service configuration can drift: guide supplies per-service exact settings and a release checklist.
- Single replicas/volumes are not HA: guide requires off-host backup and restore rehearsal before real course data.
- Reverse proxy trust depends on Railway's edge-provided address: integration tests verify gateway sanitization; staging confirms real edge behavior.

## Out of scope

Automated infrastructure-as-code, backup automation, architecture diagrams, application-level email transport internals, and scaling beyond one replica.
