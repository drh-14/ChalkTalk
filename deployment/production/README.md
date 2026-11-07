# Single-VM ChalkTalk deployment with Supabase

This is a **runnable starting point**, not a production-readiness guarantee. It runs the frontend, Express API, Hocuspocus collaboration service, and worker as four separate production images on one Linux VM. Supabase hosts PostgreSQL and S3-compatible file storage; Resend sends mail via HTTPS. The root [`docker-compose.yml`](../../docker-compose.yml) remains the local development stack with PostgreSQL and SeaweedFS, with Resend HTTPS email.

## Topology and images

| Container       | Dockerfile                                       | Role                                                                                                   |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `web`           | `deployment/production/Dockerfile.frontend`      | Builds Vite assets and serves them through Caddy; the only published ports are TCP 80/443 and UDP 443. |
| `api`           | `deployment/production/Dockerfile.api`           | Express API, Threads WebSockets, and authorized file access; includes PDF validation and OCR tools.    |
| `collaboration` | `deployment/production/Dockerfile.collaboration` | Hocuspocus live-session WebSockets.                                                                    |
| `worker`        | `deployment/production/Dockerfile.worker`        | Durable jobs, digests, notifications, resource text extraction/OCR, and file cleanup.                  |
| `migrate`       | Reuses the API image                             | One-shot SQL schema migrations; must finish before app processes start.                                |

Caddy serves the SPA and proxies `/api/*` to Express and `/collaboration` to Hocuspocus, so browser cookies and WebSockets use the same HTTPS origin. API, worker, collaboration, and migration have outbound access to Supabase and Resend; none publishes a host port. The frontend image receives only `DOMAIN`, never database or S3 credentials.

## Prepare managed services

1. Create a **fresh** Supabase project. This guide does not copy existing PostgreSQL rows or SeaweedFS objects. ChalkTalk's normal schema migrations will create its application tables.
2. Create a **private** Supabase Storage bucket. Enable its S3 protocol and generate a server-side S3 access key pair. Obtain endpoint, region, and bucket name from the Supabase dashboard. The S3 keys bypass Storage RLS; keep them on the VM only and let ChalkTalk's API enforce course/file access. Do not make the bucket public.
3. Obtain a PostgreSQL connection URL from **Supabase > Connect**. Use `db.<20-character-project-ref>.supabase.co:5432` for the direct connection if the VM has IPv6 connectivity; otherwise use the IPv4 session pooler `aws-<index>-<region>.pooler.supabase.com:5432` with username `<role>.<project-ref>`, not transaction pooling on port 6543. Migrations use a session-level advisory lock. Include exactly one explicit TLS mode in `DATABASE_URL` (`sslmode=require`, `verify-ca`, or `verify-full`); an omitted or disabled mode fails startup. Verify connectivity from the VM before starting.
4. **Do not pre-enable `pg_trgm` in the Supabase Dashboard**: ChalkTalk's existing migration installs it into `public`, and fuzzy-search SQL calls `public.strict_word_similarity`. Supabase recommends an `extensions` schema and may show an advisor warning for this accepted project-specific choice. Verify it after migrations with `SELECT extnamespace::regnamespace FROM pg_extension WHERE extname='pg_trgm';` (expect `public`) and run a fuzzy-search smoke test. If it is already enabled elsewhere, stop and resolve that mismatch before deploying.
5. Configure a verified sending domain and sending-only Resend key. The deployment does not use SMTP or Mailpit.

## Prepare a pinned release

1. Point your domain's A/AAAA records at the VM. Allow inbound TCP 80/443 and UDP 443; allow outbound HTTPS, DNS, and PostgreSQL to Supabase. Do **not** publish API, Hocuspocus, or database ports.
2. Clone this repository on the VM and check out an **explicit tested commit SHA**, not a moving branch: `git fetch origin && git checkout --detach <commit-sha>`. Record that SHA for rollback.
3. `cp deployment/production/.env.example deployment/production/.env && chmod 600 deployment/production/.env`. Fill all placeholders. Generate an independent `AUTH_TOKEN_SECRET` (for example `openssl rand -hex 32`). `DOMAIN` has no scheme or trailing slash. Copy the exact Supabase connection values from its dashboard and URL-encode reserved password characters.
4. Validate without starting containers:

   ```sh
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml config --quiet
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml config --services
   ```

   The expected services are `migrate`, `api`, `worker`, `collaboration`, and `web`. No PostgreSQL, SeaweedFS, SMTP, or Mailpit service should appear.

5. Build all four production images and start the stack:

   ```sh
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml build web api collaboration worker
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml up -d
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml ps
   docker compose --env-file deployment/production/.env -f deployment/production/compose.yml logs --tail=100 migrate api web
   curl -fsS https://YOUR_DOMAIN/api/health
   ```

`migrate` must exit with code 0. API, worker, and collaboration wait for it; Caddy waits for API health. First certificate issuance requires working public DNS and ports 80/443. The frontend is a static build; there is no Vite server, mock seed, or source bind mount.

## Required environment

| Variable                                                                            | Purpose                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `DOMAIN`                                                                            | Public HTTPS origin, including API and collaboration routes.        |
| `DATABASE_URL`                                                                      | Supabase PostgreSQL URL with an explicit TLS mode.                  |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private Supabase Storage S3 settings.                               |
| `AUTH_TOKEN_SECRET`                                                                 | Independent random session-signing secret (at least 32 characters). |
| `RESEND_API_KEY`                                                                    | Resend HTTPS sending-only key; sender is fixed in API constants.    |

The production images and Compose set `NODE_ENV=production`; there is no custom mode flag in the env file. Production accepts only the Supabase database hosts above and same-project S3 endpoints `https://<project-ref>.storage.supabase.co/storage/v1/s3` (preferred) or `https://<project-ref>.supabase.co/storage/v1/s3`, with no custom port, credentials, query, or fragment. It rejects missing or malformed managed values instead of falling back to a local endpoint or ambient S3 credentials; it also rejects SMTP selection. `RESEND_API_BASE_URL`, if set, must be the official `https://api.resend.com` origin; omit it for normal delivery. Remove any old `PROD`, `PRODUCTION`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` settings. `TRUST_PROXY_HOPS=1` is set by Compose; Caddy must remain the **only public entry point**, or per-IP rate limits can trust a spoofed proxy header.

## Operate and verify

- `docker compose --env-file deployment/production/.env -f deployment/production/compose.yml logs -f --tail=100 api worker collaboration web`
- `docker compose --env-file deployment/production/.env -f deployment/production/compose.yml restart api worker collaboration`
- `docker compose --env-file deployment/production/.env -f deployment/production/compose.yml down` stops the app. The managed data persists in Supabase; Caddy's named volumes retain certificates. Do not run `down -v` unless you intend to remove those certificate volumes.
- Before launch, test authenticated signup, a post, a private resource upload/download/delete, a live collaboration session, and an accepted Resend message through the public domain. Confirm restricted files remain inaccessible to unauthorized users.
- If Supabase DB or Storage is unavailable, expect API or worker failures; monitor logs and retry after service restoration. A failed migration must be repaired before starting the app.

For updates, record the old SHA, check out the new tested SHA, verify backups, and rebuild/restart. Schema migrations may not be reversible; reverting code alone is not a reliable database rollback. Supabase does not eliminate the need for backup/restore planning. A real VM and disposable Supabase-project smoke test must pass before placing non-test course data here.

The API and worker images include qpdf, Poppler, Tesseract, and English OCR data. OCR settings are fixed in [`constants.ts`](../../apps/api/src/config/constants.ts); no OCR environment variables are required.
