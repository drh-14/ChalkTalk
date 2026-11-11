# Local development

Run these commands from the repository root in a Bash-compatible shell (Windows users can use WSL). You need Docker with the Compose plugin (`docker compose`). Compose and the explicit Piazza import do not require Node.js on the host; repository checks require an up-to-date Node.js **22** release and npm.

## 1. Create local configuration

```bash
cp deployment/local/.env.example .env
openssl rand -hex 32              # copy the output into AUTH_TOKEN_SECRET in .env
```

Edit the ignored `.env` before starting. Replace `AUTH_TOKEN_SECRET`, `METRICS_TOKEN`, and `GRAFANA_ADMIN_PASSWORD` with separate random values, and configure `RESEND_API_KEY` with your team key. Real verification and notification emails will be sent from ChalkTalk's fixed sender. Set `DOMAIN` to the local hostname you will open (default `localhost`); Compose derives the frontend URLs. Use a valid `.edu` address (including valid subdomains) for signup. The template's local storage credentials are development placeholders, **not** deployment secrets. `.env` is ignored by Git; never commit it.

If reusing an older `.env`, remove its `PORT` entry. Local Compose requires the API's internal port 3000 and rejects `PORT` before migrations.

## 2. Start the local stack

```bash
docker compose -f deployment/local/compose.yml --env-file .env up --build --wait
```

This single command starts PostgreSQL, SeaweedFS, migrations, the API, worker, collaboration server, Caddy gateway, private Vite web client, Prometheus, Grafana, Loki, and Alloy. A new database has no users or courses. Create a course in the app or explicitly import one from Piazza; startup never loads sample data. With the default `DOMAIN` and `WEB_PORT`, the web client is [https://localhost:5173](https://localhost:5173); otherwise open `https://<DOMAIN>:<WEB_PORT>` using your configured values. The first image build may take a few minutes. Re-running the command preserves named-volume data. For logs, run `docker compose -f deployment/local/compose.yml --env-file .env logs -f api` (or another service).

## 3. Trust the local HTTPS certificate and open the app

Caddy creates the local HTTPS certificate and its own CA automatically when Compose starts. No host certificate-generation command is needed. After the stack is running, export **only the CA's public root certificate**:

```bash
docker compose -f deployment/local/compose.yml --env-file .env cp \
  gateway:/data/caddy/pki/authorities/local/root.crt /tmp/chalktalk-local-root.crt
```

Trust `/tmp/chalktalk-local-root.crt` once in your host OS or browser trust store (on macOS, open it in Keychain Access and set it to **Always Trust**; on Linux, use your distribution's CA-import procedure). Never export Caddy's `root.key` or mount its private CA data on the host. Its `/data` volume preserves the CA across restarts; if you delete volumes, export and trust the newly generated root. Until then, the browser will warn about the certificate. Open `https://<DOMAIN>:<WEB_PORT>` (defaults: `https://localhost:5173`) after trusting the root.

| Local endpoint                                   | Purpose                                            |
| ------------------------------------------------ | -------------------------------------------------- |
| [https://localhost:5173](https://localhost:5173) | Web app; Caddy proxies `/api` and `/collaboration` |
| `http://127.0.0.1:8333`                          | SeaweedFS S3-compatible object store               |

In full Compose mode, the API is not exposed on a host port; the Caddy gateway exposes its health route at `https://localhost:5173/api/health`. Sign up using a valid `.edu` email address, then follow the verification link delivered to your inbox through Resend. The collaboration WebSocket is reached through `wss://localhost:5173/collaboration`.

## Environment variables

Copying `deployment/local/.env.example` provides the local defaults. The table identifies what to edit and which settings Compose deliberately overrides inside its containers.

| Variable(s)                                                      | Local purpose / required change                                                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_TOKEN_SECRET`                                              | Replace the template with a random secret of at least 32 characters.                                                                                  |
| `DOMAIN`                                                         | Browser hostname (default `localhost`). Compose derives the frontend URLs as `https://<DOMAIN>:<WEB_PORT>`.                                           |
| `DATABASE_URL`                                                   | Local PostgreSQL connection; Compose uses the internal `postgres` hostname.                                                                           |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`                               | Compose selects Resend. Set a sending-only API key; the sender address is fixed in code.                                                              |
| `SEAWEEDFS_ACCESS_KEY_ID`, `SEAWEEDFS_SECRET_ACCESS_KEY`, `S3_*` | Local SeaweedFS credentials, bucket, and endpoint. The template values are development placeholders; Compose uses the internal SeaweedFS hostname.    |
| `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_PORT`        | Set **different** random secrets for the metrics token and Grafana password. Grafana defaults to host port 3001.                                      |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`     | Optional semantic matching. Private text and search queries go to the configured provider; see [Optional semantic search](#optional-semantic-search). |

Resource OCR is limited to 200 PDF pages needing OCR per file and uses English Tesseract data, as fixed in `apps/api/src/config/constants.ts`; it does not use environment variables.

`WEB_PORT` is a Compose-only host-port override (default 5173), not an API variable. For local Compose, `COMPOSE_ENV_FILE` can point services to another env file relative to the repository root; pass the same file with Compose `--env-file` for interpolation. Most teammates should simply use `.env`. API rate limits and OCR limits are code constants rather than environment settings.

For **real email delivery**, configure a sending-only `RESEND_API_KEY` for both API and worker. The sender is fixed as `ChalkTalk <notifications@joinchalktalk.com>` in API constants. Local Compose selects `EMAIL_PROVIDER=resend`. Use `RESEND_API_BASE_URL` only for isolated mock tests; omit it for real Resend. Queued retries use a frozen payload and stable Resend idempotency key; Resend’s bounded key window does not guarantee exactly-once delivery after expiry. For opt-out timing during delivery, see [course email preferences](../../documentation/api/courses.md#courseEmailPreferences). Never commit or share provider credentials.

For a **manual live Resend acceptance check**, start a disposable PostgreSQL server bound to loopback and set `TEST_DATABASE_URL` to its administrative database. Set `RESEND_LIVE_CONFIRM=send-synthetic-mail`, `RESEND_LIVE_RECIPIENT` to the approved test inbox, and the normal Resend variables, then run `npm run test:email:live`. The command creates and removes its own uniquely named database, sends no more than twelve synthetic messages, and refuses a non-approved recipient, remote database, or mock Resend endpoint. This command is never part of regular CI; it checks provider acceptance, not inbox arrival. See [live validation design](../../documentation/design/2026-11-02-resend-live-validation.md).

## Importing a Piazza class

To populate a new installation with a real course, first create a normal ChalkTalk account, then import a Piazza class you belong to. Read the password without placing it in shell history:

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

Run this after the stack is up. `PIAZZA_EMAIL` signs in to Piazza; `CHALKTALK_OWNER_EMAIL` must be an existing ChalkTalk account and can be different. The API container already has the database connection and npm dependencies; `--save` writes into the repository's bind mount. To re-import a saved export, run `docker compose -f deployment/local/compose.yml --env-file .env exec -T api npm run db:import:piazza -- --owner "$CHALKTALK_OWNER_EMAIL" --from piazza-cse416.json`.

The `--owner` ChalkTalk account must already exist and becomes the course instructor; your own Piazza posts are attributed to it. Every other Piazza author becomes a course member with their Piazza name and role (professor → instructor, TA, student) and a placeholder `@piazza.invalid` email. These historical attribution accounts receive discarded random passwords; they are not shared demo logins. Questions, notes, instructor and student answers, followups and replies, folders (as tags), pins, endorsements, and helpful votes are imported with their original timestamps. Piazza HTML becomes Markdown, and images and attachments stay linked to Piazza. Polls become notes without their options. Piazza hides anonymous authors from students, so those posts belong to one shared "Anonymous Piazza user". A student account also sees only its own private posts and cannot read the roster or emails.

The command fetches one request per second, so a large class takes several minutes. Run it again at any time: matching Piazza ids add new content and refresh edited content without duplicating anything, and content deleted in ChalkTalk stays deleted. `--save` keeps the fetched data, and `--from piazza-cse416.json` re-imports from that file without contacting Piazza. Piazza has no public API; this uses the internal API its own website calls, which may change without notice.

## Optional semantic search

The main local Compose stack uses PostgreSQL with pgvector and runs the vector migration alongside ordinary migrations. No separate semantic-search Compose file is needed. Ordinary full-text and fuzzy search still works without an external service. To add semantic matching, set `EMBEDDING_API_KEY` for an OpenAI-compatible embeddings endpoint in the ignored `.env` (and optionally `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`), then start the usual stack with `docker compose -f deployment/local/compose.yml --env-file .env up --build --wait`.

If you have an existing populated local volume created with the earlier `postgres:17-alpine` image, back it up before switching images. Search falls back to lexical/fuzzy when the optional provider or key is unavailable. Production remains separately configured against Supabase and does not run the optional vector migration automatically.

## Local observability

Prometheus, Grafana, Loki, and Alloy start with the rest of the local stack. Set `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` in `.env` to **different** outputs of `openssl rand -hex 32` before starting. Open Grafana at [http://127.0.0.1:3001](http://127.0.0.1:3001) and sign in as `admin` with `GRAFANA_ADMIN_PASSWORD`. See the [observability reference](../../documentation/api/observability.md). Do not commit credentials or expose monitoring endpoints publicly.

## Stop, troubleshoot, and check changes

```bash
docker compose -f deployment/local/compose.yml --env-file .env ps                    # service status
docker compose -f deployment/local/compose.yml --env-file .env logs migrate          # migration failure details
docker compose -f deployment/local/compose.yml --env-file .env run --rm migrate      # rerun tracked migrations
docker compose -f deployment/local/compose.yml --env-file .env down                  # stop the stack; keep data
```

`docker compose -f deployment/local/compose.yml --env-file .env down --volumes` also **deletes local PostgreSQL, object-store, and other named-volume data**, including Caddy's local CA; use it only to intentionally reset the environment. If ports 5432, 5173, or 8333 are occupied, stop the conflicting service or configure an explicit port override. If HTTPS is untrusted, repeat the [local HTTPS trust step](#3-trust-the-local-https-certificate-and-open-the-app) and confirm `DOMAIN` matches the hostname you opened. If API startup fails, inspect `migrate` and `api` logs before deleting data.

Run the repository checks before submitting code:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```
