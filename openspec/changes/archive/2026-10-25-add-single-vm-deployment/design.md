## Context

The deployment target is one Linode Linux VM running Docker Compose. The domain points to that VM. AWS SES remains the SMTP provider and SeaweedFS remains the S3-compatible object store. No existing Channels deployment data needs migration.

## Decisions

- Build images from a pinned Git commit on the VM. A multistage Dockerfile compiles TypeScript/React once, then produces a minimal Node runtime and a Caddy static-web target. There are no source bind mounts.
- Publish only Caddy's ports 80 and 443. It terminates TLS, serves the built SPA, preserves `/api/v1` paths to Express, rewrites only `/api/health`, and reverse-proxies `/collaboration` WebSockets.
- Keep PostgreSQL and SeaweedFS on named volumes and private Compose networking. Migrations are a one-shot service gated on PostgreSQL health; API, worker, and collaboration wait for successful completion.
- Set Express `trust proxy` to exactly one hop only when `TRUST_PROXY_HOPS=1`; default stays untrusted for development/direct serving. The API is not host-published, and Caddy is the only public entry point. Caddy must not trust incoming client-supplied forwarded headers.
- Default monitoring is health checks and bounded JSON container logs; no observability stack. SES uses port 465 TLS through existing SMTP configuration.
- Off-host backup automation, live production validation, and deployment diagram edits are outside this initial skeleton.

## Risks

- One VM is a single failure domain; volumes alone are not backups. A separate off-host backup/restore plan is required before real data is entrusted to it.
- Reverse-proxy trust is safe only while the API remains internal and only Caddy can reach it. Publishing API port 3000 would allow forged forwarding headers and per-IP limit bypass.
- Deployment secrets live in an ignored environment file on the VM; operators must restrict file permissions and avoid committing it.
