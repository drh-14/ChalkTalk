# Single-VM ChalkTalk deployment with Supabase

This is a **runnable starting point**, not a production-readiness guarantee. It runs the frontend, Express API, Hocuspocus collaboration service, and worker as four separate production images on one Linux VM. Supabase hosts PostgreSQL and S3-compatible file storage; Resend sends mail via HTTPS. The local development stack is [`deployment/local/compose.yml`](../local/compose.yml), with PostgreSQL, SeaweedFS, and Resend HTTPS email.

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
2. **Before running any ChalkTalk migration, disable the Supabase Data API in the project dashboard** as described in [Supabase's API security guide](https://supabase.com/docs/guides/api/securing-your-api). ChalkTalk creates application tables in `public` and does not use Supabase Data API authorization; leaving that API enabled could expose course data outside ChalkTalk. This is a manual, security-critical prerequisite: the Compose stack cannot verify the dashboard setting. Do not start the stack until you have confirmed it is disabled.
3. Create a **private** Supabase Storage bucket. Enable its S3 protocol and generate a server-side S3 access key pair. Obtain endpoint, region, and bucket name from the Supabase dashboard. The S3 keys bypass Storage RLS; keep them on the VM only and let ChalkTalk's API enforce course/file access. Do not make the bucket public.
4. Obtain a PostgreSQL connection URL from **Supabase > Connect**. Use `db.<20-character-project-ref>.supabase.co:5432` for the direct connection if the VM has IPv6 connectivity; otherwise use the IPv4 session pooler `aws-<index>-<region>.pooler.supabase.com:5432` with username `<role>.<project-ref>`, not transaction pooling on port 6543. Migrations use a session-level advisory lock. Include exactly one explicit TLS mode in `DATABASE_URL` (`sslmode=require`, `verify-ca`, or `verify-full`); an omitted or disabled mode fails startup. Verify connectivity from the VM before starting.
5. **Do not pre-enable `pg_trgm` in the Supabase Dashboard**: ChalkTalk's existing migration installs it into `public`, and fuzzy-search SQL calls `public.strict_word_similarity`. Supabase recommends an `extensions` schema and may show an advisor warning for this accepted project-specific choice. Verify it after migrations with `SELECT extnamespace::regnamespace FROM pg_extension WHERE extname='pg_trgm';` (expect `public`) and run a fuzzy-search smoke test. If it is already enabled elsewhere, stop and resolve that mismatch before deploying.
6. Configure a verified sending domain and sending-only Resend key. The deployment does not use SMTP or Mailpit.

## Prepare a pinned release

After the VM bootstrap and production environment are prepared, a successful
`main` push CI run automatically starts the [production deploy
workflow](../../.github/workflows/deploy-production.yml). It accepts only the
repository's current `main` SHA, checks that SHA again before changing the VM,
and checks it out detached under `/srv/chalktalk/releases/<sha>`. Bootstrap and
deploy share a GitHub Actions concurrency group; the VM also uses
`/srv/chalktalk/shared/deploy.lock`. Production secrets stay in the bootstrap-
managed `/srv/chalktalk/shared/production.env` file, which Compose uses as both
its interpolation `--env-file` and service `COMPOSE_ENV_FILE`. Do not put a
secret `.env` inside a release checkout.

The deploy builds all four images before Compose starts them and forces Compose
to recreate services for each new SHA, even if images and configuration have
not changed. It verifies the migration exit status, API health,
worker/collaboration process state, migration ledger, a temporary private
Supabase Storage object write/read/delete, and one
Resend-accepted synthetic email to `chalktalk602@gmail.com`. The runner then
checks public HTTPS web and `/api/health`; only afterward does the VM write
`/srv/chalktalk/shared/deployed.sha`. A repeated successful SHA skips provider
smoke, including mail. An interrupted first run may retry the same Resend
idempotency key for up to 24 hours; beyond that, a duplicate test mail is
possible. The Storage object is deleted even on read failure; a cleanup failure
fails deployment.

If build, migration, startup, provider smoke, or public HTTPS fails, the workflow
stops without marking the SHA successful. It retains old release checkouts but
does **not** automatically restore containers or roll back the database; inspect
Compose logs and migration state before manually recovering. The workflow
requires the separate VM bootstrap to finish successfully and a valid production
environment. Live VM/Supabase/Resend verification remains pending until
bootstrap succeeds; local tests cannot substitute for that check.

The following manual pinned-release procedure remains available for recovery:

1. Point your domain's A/AAAA records at the VM. Allow inbound TCP 80/443 and UDP 443; allow outbound HTTPS, DNS, and PostgreSQL to Supabase. Do **not** publish API, Hocuspocus, or database ports.
2. Clone this repository on the VM and check out an **explicit tested commit SHA**, not a moving branch: `git fetch origin && git checkout --detach <commit-sha>`. Record that SHA for rollback.
3. On a bootstrapped VM, use `/srv/chalktalk/shared/production.env`, not a secret file in the release checkout. Confirm bootstrap has populated it from the production environment settings. `DOMAIN` has no scheme or trailing slash; the Supabase connection values must match its dashboard, with reserved password characters URL-encoded. For a standalone manual installation without bootstrap, prepare an owner-only environment file outside the checkout from [`.env.example`](.env.example), including an independent `AUTH_TOKEN_SECRET` (for example `openssl rand -hex 32`), and substitute its path in the commands below. Export that same path as `COMPOSE_ENV_FILE` so containers receive the environment file, not just Compose interpolation values.
4. Validate without starting containers:

   ```sh
   export COMPOSE_ENV_FILE=/srv/chalktalk/shared/production.env
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml config --quiet
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml config --services
   ```

   The expected services are `migrate`, `api`, `worker`, `collaboration`, and `web`. No PostgreSQL, SeaweedFS, SMTP, or Mailpit service should appear.

5. Build all four production images and start the stack:

   ```sh
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml build web api collaboration worker
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml up -d
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml ps
   docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml logs --tail=100 migrate api web
   curl -fsS https://YOUR_DOMAIN/api/health
   ```

`migrate` must exit with code 0. API, worker, and collaboration wait for it; Caddy waits for API health. First certificate issuance requires working public DNS and ports 80/443. The frontend is a static build; there is no Vite server, mock seed, or source bind mount.

## Required environment

| Variable                                                                                                                                                  | Purpose                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                                                                                                                                  | Public HTTPS origin, including API and collaboration routes.                                      |
| `DATABASE_URL`                                                                                                                                            | Supabase PostgreSQL URL with an explicit TLS mode.                                                |
| `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, `SUPABASE_STORAGE_SECRET_ACCESS_KEY` | Private Supabase Storage S3-compatible settings.                                                  |
| `AUTH_TOKEN_SECRET`                                                                                                                                       | Independent random secret for HMAC-hashing opaque authentication tokens (at least 32 characters). |
| `RESEND_API_KEY`                                                                                                                                          | Resend HTTPS sending-only key; sender is fixed in API constants.                                  |

The production images and Compose set `NODE_ENV=production`; there is no custom mode flag in the env file. Production accepts only the Supabase database hosts above and same-project S3 endpoints `https://<project-ref>.storage.supabase.co/storage/v1/s3` (preferred) or `https://<project-ref>.supabase.co/storage/v1/s3`, with no custom port, credentials, query, or fragment. It rejects missing or malformed managed values instead of falling back to a local endpoint or ambient S3 credentials; it also rejects SMTP selection. `RESEND_API_BASE_URL`, if set, must be the official `https://api.resend.com` origin; omit it for normal delivery. Remove any old `PROD`, `PRODUCTION`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` settings. `TRUST_PROXY_HOPS=1` is set by Compose; Caddy must remain the **only public entry point**, or per-IP rate limits can trust a spoofed proxy header.

If upgrading an earlier production env file, rename its five `S3_*` entries to the corresponding `SUPABASE_STORAGE_*` entries before restarting. Production no longer reads the old names; local SeaweedFS still uses `S3_*`.

## Operate and verify

Production runs no Prometheus, Grafana, Logstash, Elasticsearch, metrics endpoint, or event spool, even if `METRICS_TOKEN` is accidentally set. Docker retains basic container stdout logs with a 10 MiB maximum per file and three files per service; this is size-bounded, not an age-based retention policy.

Run these commands from the pinned release checkout with `COMPOSE_ENV_FILE` exported to the same environment-file path used by `--env-file` above.

- `docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml logs -f --tail=100 api worker collaboration web`
- `docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml restart api worker collaboration`
- `docker compose --env-file /srv/chalktalk/shared/production.env -f deployment/production/compose.yml down` stops the app. The managed data persists in Supabase; Caddy's named volumes retain certificates. Do not run `down -v` unless you intend to remove those certificate volumes.
- Before launch, test authenticated signup, a post, a private resource upload/download/delete, a live collaboration session, and an accepted Resend message through the public domain. Confirm restricted files remain inaccessible to unauthorized users.
- If Supabase DB or Storage is unavailable, expect API or worker failures; monitor logs and retry after service restoration. A failed migration must be repaired before starting the app.

For automatic updates, verify backups before merging to `main` and record the previously deployed SHA for recovery. If you must recover manually, use the pinned-release procedure above; a later automatic run for a previously marked SHA checks the running release before skipping deployment and does not resend provider smoke. Schema migrations may not be reversible; reverting code alone is not a reliable database rollback. Supabase does not eliminate the need for backup/restore planning. A real VM and disposable Supabase-project smoke test must pass before placing non-test course data here.

The API and worker images include qpdf, Poppler, Tesseract, and English OCR data. OCR settings are fixed in [`constants.ts`](../../apps/api/src/config/constants.ts); no OCR environment variables are required.
