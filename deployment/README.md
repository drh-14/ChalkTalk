# Single-VM Compose deployment skeleton

This is a **runnable starting point**, not a production-readiness guarantee. It targets one Linux VM (including a Linode VM) with a domain, Docker Engine and Compose v2. It does not replace the repository-root **development** `docker-compose.yml`.

## Topology

- Public: Caddy on TCP 80/443 and UDP 443. It obtains/renews the domain's TLS certificate, serves compiled React assets, proxies `/api/*` to Express and `/collaboration` to the WebSocket service.
- Private: compiled API, worker, collaboration server, one-shot migration job, PostgreSQL 17 and SeaweedFS. Only Caddy publishes host ports; PostgreSQL and SeaweedFS use named volumes. `edge` provides internet egress to the API/worker for SES; `data` is an internal network.
- The existing email code sends via AWS SES SMTP on port 465. This stack does not start Mailpit or send a test message by itself.

## Prepare a pinned release

1. Point the domain's DNS A/AAAA records at the VM. Allow inbound TCP 80/443 (and UDP 443 for HTTP/3); do **not** publish database, SeaweedFS, API or collaboration ports. Permit outbound DNS, HTTPS and SES SMTP port 465.
2. Clone the repository on the VM, then check out an **explicit tested commit SHA** rather than a moving branch: `git fetch origin && git checkout --detach <commit-sha>`. Record the SHA for rollback.
3. `cp deployment/.env.example deployment/.env && chmod 600 deployment/.env`. Set every placeholder. Generate independent secrets, for example `openssl rand -hex 32`. `POSTGRES_PASSWORD` and the password embedded in `DATABASE_URL` must match; URL-encode reserved characters or use a URL-safe password. Set `DOMAIN` without a scheme or trailing slash. Use a verified SES sender in `SMTP_FROM` and SES **SMTP** credentials (not AWS API access keys). SES sandbox restrictions, sender verification and account send limits still apply.
4. Review configuration without starting containers:

   ```sh
   docker compose --env-file deployment/.env -f deployment/compose.yml config --quiet
   docker compose --env-file deployment/.env -f deployment/compose.yml config --services
   ```

5. Build and start from that pinned checkout:

   ```sh
   docker compose --env-file deployment/.env -f deployment/compose.yml up -d --build
   docker compose --env-file deployment/.env -f deployment/compose.yml ps
   docker compose --env-file deployment/.env -f deployment/compose.yml logs --tail=100 migrate api web
   curl -fsS https://YOUR_DOMAIN/api/health
   ```

`migrate` must exit with code 0. The API waits for migrations and Caddy waits for the API health check. First certificate issuance needs working public DNS and port 80/443 reachability. The frontend is a static build; there is no Vite server, mock seed or source bind mount.

## Required environment

| Variable                                                                           | Purpose                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DOMAIN`                                                                           | Public HTTPS domain and same-origin WebSocket endpoint.                             |
| `POSTGRES_PASSWORD`, `DATABASE_URL`                                                | Matching PostgreSQL credential and internal connection URL.                         |
| `AUTH_TOKEN_SECRET`                                                                | Independent random session-signing secret (at least 32 characters).                 |
| `ALLOWED_SCHOOL_DOMAINS`                                                           | Comma-separated domains permitted for account signup.                               |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SES SMTP endpoint, port 465, TLS and verified sender.                               |
| `SEAWEEDFS_ACCESS_KEY_ID`, `SEAWEEDFS_SECRET_ACCESS_KEY`                           | Private S3-compatible storage credentials, reused by SeaweedFS and the application. |
| `S3_BUCKET`, `S3_REGION`                                                           | Storage bucket and SDK region; `S3_ENDPOINT` is set internally to SeaweedFS.        |

`TRUST_PROXY_HOPS=1` is set by Compose for the API. **Do not publish the API directly**: it trusts exactly one Caddy proxy hop for authentication per-IP rate limits, and Caddy must remain the only public entry point. Local development continues with proxy trust disabled.

## Operate and update

- `docker compose --env-file deployment/.env -f deployment/compose.yml logs -f --tail=100 api worker collaboration web`
- `docker compose --env-file deployment/.env -f deployment/compose.yml restart api worker collaboration`
- `docker compose --env-file deployment/.env -f deployment/compose.yml down` stops services **without** removing the named data volumes. Never run `down -v` against real data.
- For an update, record the old SHA, check out the new tested SHA, back up data, and rerun `up -d --build`. The migration job is idempotent, but schema migrations may not be reversible; rolling back only the code can be unsafe.

## Not yet included

**Do not entrust irreplaceable course data to this stack until off-host encrypted PostgreSQL and SeaweedFS backups, a seven-day retention policy, and a restore rehearsal are implemented.** The named volumes survive container recreation but not VM/disk loss. A real DNS/TLS/SES/storage end-to-end smoke test on the target VM is also required. The deployment diagram updates and backup automation were explicitly deferred for this skeleton.
