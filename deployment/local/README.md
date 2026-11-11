# Local development

The Compose setup below is for **reproducible local development**. It includes hot-reloading servers, local data services, and real Resend HTTPS email. Do not expose it publicly without replacing those settings, TLS termination, storage, backups, and email configuration.

## Start locally

Run these commands from the repository root in a Bash-compatible shell (Windows users can use WSL). You need Docker with the Compose plugin (`docker compose`) and [`mkcert`](https://github.com/FiloSottile/mkcert#installation). Compose and the explicit Piazza import do not require Node.js on the host; repository checks require an up-to-date Node.js **22** release and npm.

### 1. Create local configuration and HTTPS certificate

```bash
cp deployment/local/.env.example .env
mkcert -install                    # once per computer; installs a local trust root
mkdir -p .cert
openssl rand -hex 32              # copy the output into AUTH_TOKEN_SECRET in .env
```

Edit the ignored `.env` before generating the certificate or starting Compose. Replace `AUTH_TOKEN_SECRET`, `METRICS_TOKEN`, and `GRAFANA_ADMIN_PASSWORD` with separate random values, and configure `RESEND_API_KEY` with your team key. Real verification and notification emails will be sent from ChalkTalk's fixed sender. Set `DOMAIN` to the local hostname you will open (default `localhost`); keep it as an unquoted hostname in `.env`. Compose derives the frontend URLs. Then generate a certificate for that hostname:

```bash
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env)
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem "$DOMAIN"
```

Use a valid `.edu` address (including valid subdomains) for signup. The template's local storage credentials are development placeholders, **not** deployment secrets. `.env` and `.cert/` are ignored by Git; never commit them.

If reusing an older `.env`, remove its `PORT` entry. Local Compose requires the API's internal port 3000 and rejects `PORT` before migrations; direct API and test runs can still override the port.

### 2. Start the local stack

```bash
docker compose -f deployment/local/compose.yml --env-file .env up --build --wait
```

This single command starts PostgreSQL, SeaweedFS, migrations, the API, worker, collaboration server, web client, Prometheus, Grafana, Loki, and Alloy. A new database has no users or courses. Create a course in the app or explicitly import one from Piazza; startup never loads sample data. With the default `DOMAIN` and `WEB_PORT`, the web client is [https://localhost:5173](https://localhost:5173); otherwise use `https://<DOMAIN>:<WEB_PORT>` with the values from `.env`. The first image build may take a few minutes. Re-running the command preserves named-volume data. For logs, run `docker compose -f deployment/local/compose.yml --env-file .env logs -f api` (or another service).

### 3. Open the app and verify it

| Local endpoint                                   | Purpose                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [https://localhost:5173](https://localhost:5173) | Web app with default `DOMAIN` and `WEB_PORT`; Vite proxies `/api` and `/collaboration` |
| `http://127.0.0.1:8333`                          | SeaweedFS S3-compatible object store                                                   |

The API is not exposed on a host port; the web proxy exposes its health route at `https://localhost:5173/api/health` with the defaults. Sign up using a valid `.edu` email address, then follow the verification link delivered to your inbox through Resend. The collaboration WebSocket is reached through `wss://localhost:5173/collaboration` with the defaults. Replace `localhost:5173` in these URLs with your chosen `DOMAIN:WEB_PORT` if changed.

### Environment variables

Copying `deployment/local/.env.example` provides the local defaults. The table identifies what to edit and which settings Compose deliberately overrides inside its containers.

| Variable(s)                                                                         | Local purpose / required change                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_TOKEN_SECRET`                                                                 | **Required:** replace the template with a random secret of at least 32 characters; used to HMAC-hash and verify opaque authentication-related tokens.                                                                                                |
| `DOMAIN`                                                                            | Local frontend hostname (default `localhost`). Compose derives `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL` as `https://<DOMAIN>:<WEB_PORT>`; the API retains lower-level overrides for direct/test modes.                                             |
| `DATABASE_URL`                                                                      | Local PostgreSQL connection. Compose overrides the hostname with its internal `postgres` service.                                                                                                                                                    |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_API_BASE_URL`                           | Local Compose selects Resend. Set a sending-only API key; the sender is fixed in code. `RESEND_API_BASE_URL` is only for isolated mocked-network tests. Production selects Resend through `NODE_ENV=production`.                                     |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Compose uses SeaweedFS internally and reads its local credentials from `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY`. The host-facing `S3_ENDPOINT` in `.env` is for local tooling; these are **local object-store keys**, not AWS keys. |
| `COLLABORATION_PORT`, `COLLABORATION_PUBLIC_URL`                                    | Collaboration's internal WebSocket port (3100) and browser WebSocket URL. The API uses its internal default port 3000; the public WebSocket URL defaults to the frontend HTTPS host plus `/collaboration`.                                           |
| `VITE_TLS_KEY_PATH`, `VITE_TLS_CERT_PATH`                                           | Vite TLS files generated above; Compose mounts `.cert/` and supplies container paths.                                                                                                                                                                |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`                        | Optional semantic search provider. Do not put the key in browser/Vite variables; private post text and search queries are sent to that provider. See [Optional semantic search](#optional-semantic-search).                                          |
| `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_PORT`                           | Required local monitoring. Set **different** random secrets for the token and Grafana password. Default Grafana host port is 3001.                                                                                                                   |
| `COLLABORATION_IDLE_END_MINUTES`, `LOG_SPOOL_DIRECTORY`                             | Live-session idle timeout and observability log location. API rate limits are fixed in `apps/api/src/config/constants.ts` rather than set through environment variables.                                                                             |

Resource OCR is limited to 200 PDF pages needing OCR per file and uses English Tesseract data, as fixed in `apps/api/src/config/constants.ts`; it does not use environment variables.

`NODE_ENV=production` is set by the production images/Compose and is not a custom user mode flag. `WEB_PORT` is a Compose-only host-port override (default 5173), not an API variable. For local Compose, `COMPOSE_ENV_FILE` can point services to another env file relative to the repository root; pass the same file with Compose `--env-file` for interpolation. Most teammates should simply use `.env`.

For **real email delivery**, configure a sending-only `RESEND_API_KEY` for both API and worker. The sender is fixed as `ChalkTalk <notifications@joinchalktalk.com>` in API constants. Local Compose selects `EMAIL_PROVIDER=resend`. Use `RESEND_API_BASE_URL` only for isolated mock tests; omit it for real Resend. Queued retries use a frozen payload and stable Resend idempotency key; Resend’s bounded key window does not guarantee exactly-once delivery after expiry. For opt-out timing during delivery, see [course email preferences](../../documentation/api/courses.md#courseEmailPreferences). Never commit or share provider credentials.

For a **manual live Resend acceptance check**, start a disposable PostgreSQL server bound to loopback and set `TEST_DATABASE_URL` to its administrative database. Set `RESEND_LIVE_CONFIRM=send-synthetic-mail`, `RESEND_LIVE_RECIPIENT` to the approved test inbox, and the normal Resend variables, then run `npm run test:email:live`. The command creates and removes its own uniquely named database, sends no more than twelve synthetic messages, and refuses a non-approved recipient, remote database, or mock Resend endpoint. This command is never part of regular CI; it checks provider acceptance, not inbox arrival. See [live validation design](../../documentation/design/2026-11-02-resend-live-validation.md).

### Importing a Piazza class

To populate a new installation with a real course, first create a normal ChalkTalk account, then import a Piazza class you belong to. Enter the Piazza password without putting it in shell history:

```bash
export PIAZZA_EMAIL=you@school.edu
printf 'Existing ChalkTalk owner email: '; read -r CHALKTALK_OWNER_EMAIL
read -rsp 'Piazza password: ' PIAZZA_PASSWORD; printf '\n'
export PIAZZA_PASSWORD
docker compose -f deployment/local/compose.yml --env-file .env exec -T \
  -e PIAZZA_EMAIL -e PIAZZA_PASSWORD api \
  npm run db:import:piazza -- --owner "$CHALKTALK_OWNER_EMAIL" --class "CSE 416" --save piazza-cse416.json
unset PIAZZA_PASSWORD
```

Run this after the stack is up. `PIAZZA_EMAIL` signs in to Piazza; `CHALKTALK_OWNER_EMAIL` must be an existing ChalkTalk account and may be different. The API container already has the database connection and npm dependencies; `--save` writes into the repository's bind mount. To re-import a saved export, run `docker compose -f deployment/local/compose.yml --env-file .env exec -T api npm run db:import:piazza -- --owner "$CHALKTALK_OWNER_EMAIL" --from piazza-cse416.json`.

The `--owner` ChalkTalk account must already exist and becomes the course instructor; your own Piazza posts are attributed to it. Every other Piazza author becomes a course member with their Piazza name and role (professor → instructor, TA, student) and a placeholder `@piazza.invalid` email. These historical attribution accounts receive discarded random passwords; they are not shared demo logins. Questions, notes, instructor and student answers, followups and replies, folders (as tags), pins, endorsements, and helpful votes are imported with their original timestamps. Piazza HTML becomes Markdown, and images and attachments stay linked to Piazza. Polls become notes without their options. Piazza hides anonymous authors from students, so those posts belong to one shared "Anonymous Piazza user". A student account also sees only its own private posts and cannot read the roster or emails.

The command fetches one request per second, so a large class takes several minutes. Run it again at any time: matching Piazza ids add new content and refresh edited content without duplicating anything, and content deleted in ChalkTalk stays deleted. `--save` keeps the fetched data, and `--from piazza-cse416.json` re-imports from that file without contacting Piazza. Piazza has no public API; this uses the internal API its own website calls, which may change without notice.

### Optional semantic search

The main local Compose stack uses PostgreSQL with pgvector and runs the vector migration alongside ordinary migrations. No separate semantic-search Compose file is needed. Ordinary full-text and fuzzy search still works without an external service. To add semantic matching, set `EMBEDDING_API_KEY` for an OpenAI-compatible embeddings endpoint in the ignored `.env` (and optionally `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`), then start the usual stack with `docker compose -f deployment/local/compose.yml --env-file .env up --build --wait`.

If you have an existing populated local volume created with the earlier `postgres:17-alpine` image, back it up before switching images. Search falls back to lexical/fuzzy when the optional provider or key is unavailable. Production remains separately configured against Supabase and does not run the optional vector migration automatically.

### Local observability

Prometheus, Grafana, Loki, and Alloy start with the rest of the local stack. Set `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` in `.env` to **different** outputs of `openssl rand -hex 32` before starting. Open Grafana at [http://127.0.0.1:3001](http://127.0.0.1:3001) and sign in as `admin` with `GRAFANA_ADMIN_PASSWORD`. See the [observability reference](../../documentation/api/observability.md). Do not commit credentials or expose monitoring endpoints publicly.

### Stop, troubleshoot, and check changes

```bash
docker compose -f deployment/local/compose.yml --env-file .env ps                    # service status
docker compose -f deployment/local/compose.yml --env-file .env logs migrate          # migration failure details
docker compose -f deployment/local/compose.yml --env-file .env run --rm migrate      # rerun tracked migrations
docker compose -f deployment/local/compose.yml --env-file .env down                  # stop the stack; keep data
```

`docker compose -f deployment/local/compose.yml --env-file .env down --volumes` also **deletes local PostgreSQL, object-store, and other named-volume data**; use it only to intentionally reset the environment. If ports 5432, 5173, or 8333 are occupied, stop the conflicting service or configure an explicit port override. If HTTPS is untrusted, confirm `mkcert -install` ran and `.cert/localhost.pem` covers the `DOMAIN` hostname you opened (the filenames remain unchanged for a custom domain). If API startup fails, inspect `migrate` and `api` logs before deleting data.

Run the repository checks before submitting code:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```
