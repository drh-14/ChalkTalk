# Local development

This stack is for private local development, not public hosting. Production remains separately configured under [`deployment/production`](../production/README.md), with unchanged Supabase TLS/storage and Resend-only policy. The gateway can bind all host interfaces; protect your machine/network. Data ports are **unpublished by default**; Grafana binds loopback.

## Start

The operator host needs **Docker and Docker Compose supporting raw env files (Compose 2.30+)**, a POSIX shell, and standard shell utilities. No host Node, npm, application dependencies, AWS SDK, or cloud CLI is required. Repository development/tests require Node 22 and npm; application dependencies run inside containers.

```sh
cp deployment/local/.env.example deployment/local/.env
# Edit the ignored file: replace all three secrets and the selected provider key/sender.
./deployment/local/start.sh
```

To generate a random secret without host language dependencies, run `docker run --rm node:22-bookworm-slim node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'` separately for each secret. Never commit real credentials. Open `https://localhost:5173` after trusting the local CA below. The API listens privately on port 3000; the gateway proxies `/api` and `/collaboration`. `DOMAIN` and `WEB_PORT` derive both frontend URLs. No sample users/courses are created; signup uses real verification mail only when explicitly requested through the app.

The canonical entrypoint is:

```text
start.sh [--env-file PATH] [--project-name NAME] [--ack-external-migrations]
```

It works from any directory. An explicit relative env path is relative to the caller; the default is always `deployment/local/.env`, never a root `.env`. File values win over supported inherited inputs, then documented non-secret defaults apply. Explicit blanks are not absence. Duplicate/unknown CLI options fail. The default project remains `chalktalk`, preserving `chalktalk_postgres-data`, `chalktalk_seaweedfs-data`, and `chalktalk_caddy-data`. Use a distinct explicit project name for isolated worktrees/tests; do not start another checkout against a project currently in use.

### Restricted literal configuration

Each line is `KEY=value`, a blank line, or a whole-line `#` comment. Keys are uppercase identifiers. Values are printable ASCII with no leading/trailing whitespace, quotes, backslashes, dollar signs, backticks, CR/NUL, continuation lines, or expansion. Interior spaces and `#` are literal; subsequent `=` characters are preserved. No `export`, shell code, inline comments, duplicate keys, or dotenv quoting. The parser never sources/evaluates the file. Use percent encoding in URL components rather than shell escaping.

Supported PostgreSQL URLs use `postgres://` or `postgresql://`, one user/password pair and database name, DNS/IPv4 or bracketed IPv6, and an optional canonical decimal port. The only supported query is one `sslmode=disable|require|verify-ca|verify-full`; preserve required TLS verification. Percent escapes must encode printable ASCII. Fragments, ambiguous raw credentials, duplicate TLS parameters, unsupported query options, and malformed escapes fail. S3 endpoints allow HTTP/HTTPS and service paths, but no userinfo, query, or fragment. HTTP is intended for private S3-compatible services, not email.

## Select database and storage independently

| LOCAL_DATABASE_ENABLED | LOCAL_OBJECT_STORE_ENABLED | Selected data services                  |
| ---------------------- | -------------------------- | --------------------------------------- |
| true (default)         | true (default)             | Bundled PostgreSQL + SeaweedFS          |
| true                   | false                      | Bundled PostgreSQL + external S3        |
| false                  | true                       | External PostgreSQL + bundled SeaweedFS |
| false                  | false                      | Both external                           |

Flags accept exactly `true` or `false`, not blanks. They control provisioning only; applications receive resolved connections, not flags or the operator file.

- Bundled DB uses `LOCAL_DATABASE_USER`, `LOCAL_DATABASE_PASSWORD`, `LOCAL_DATABASE_NAME` (development defaults: `chalktalk`). **Any populated DATABASE_URL conflicts**, even an invalid/partial value.
- Bundled store uses `LOCAL_OBJECT_STORE_ACCESS_KEY_ID`, `LOCAL_OBJECT_STORE_SECRET_ACCESS_KEY`, `LOCAL_OBJECT_STORE_BUCKET`, `LOCAL_OBJECT_STORE_REGION` (template defaults). **Any populated S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, or S3_SESSION_TOKEN conflicts**, even alone.
- External DB requires complete `DATABASE_URL`. External S3 requires all five explicit endpoint/bucket/region/access-key/secret settings; `S3_SESSION_TOKEN` is optional. Generic `AWS_*` values never substitute for S3 credentials or cause bundled S3 conflicts.
- Optional `LOCAL_DATABASE_HOST_PORT` / `LOCAL_OBJECT_STORE_HOST_PORT` publish only an enabled bundled service on `127.0.0.1`. Ports must be decimal 1..65535, without leading zeroes, distinct from each other, `WEB_PORT`, and `GRAFANA_PORT`.

## Choose HTTPS email explicitly

Set `EMAIL_PROVIDER=resend|sendgrid|ses` and one valid `EMAIL_FROM` mailbox, optionally with an unquoted display name. Use your verified sender/domain. Remove **every** populated setting for other providers, including partial settings and all legacy `SMTP_*` settings. There is no fallback, SMTP delivery, gateway, arbitrary endpoint, or automatic test send.

| Provider          | Required settings                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Resend            | `RESEND_API_KEY`                                                                                                                              |
| SendGrid          | `SENDGRID_API_KEY`                                                                                                                            |
| SES explicit      | `SES_REGION`, `SES_CREDENTIALS_MODE=explicit`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`; optional `SES_SESSION_TOKEN`                     |
| SES default chain | `SES_REGION`, `SES_CREDENTIALS_MODE=default-chain`, an explicitly supplied container-accessible AWS source; no SES-prefixed credential fields |

Normal startup uses only official HTTPS mail endpoints. `RESEND_API_BASE_URL`, if supplied, must be `https://api.resend.com` (an optional trailing slash is accepted). Isolated adapter tests inject controlled transports; these are not operator delivery settings. Production still ignores legacy `EMAIL_FROM` and retains its fixed verified Resend sender.

SES explicit temporary credentials require operator renewal when expired. Default-chain clients retain the SDK provider function in each API/worker container, so refreshed sources can supply later credentials; resolved credentials are never exported to env files, another container, or queue snapshots. API and worker each resolve their own source. Standard explicit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN` are supported independently of storage.

For refreshable file sources, explicitly set `AWS_SHARED_CREDENTIALS_FILE`, `AWS_CONFIG_FILE`, `AWS_WEB_IDENTITY_TOKEN_FILE`, or `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` to a single absolute host file. Only that file is mounted read-only at a fixed `/run/chalktalk-aws/` path; its corresponding variable is rewritten to that container path. Use `AWS_PROFILE`, `AWS_ROLE_ARN`, and `AWS_ROLE_SESSION_NAME` as needed. Keep files accessible and renew tokens in place; replacing a bind-mounted inode may require restarting. Any credential-process helper selected by a profile must already be available inside the container; startup never installs/runs a host bootstrap. An explicitly reachable workload-role source can use standard `AWS_CONTAINER_CREDENTIALS_FULL_URI` / `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` inputs. No home directory is mounted, host networking is not enabled, and implicit EC2 metadata discovery is disabled. Startup does not harvest host credentials or widen access to inaccessible sources.

Successful source resolution does **not** prove SES send permission or inbox delivery. Runtime delivery failures remain sanitized and repairable. Verification/reset retain their existing immediate-mail semantics. Queued messages commit the provider, sender and frozen payload before handoff; retries revalidate eligibility and reuse identical content. Provider/sender changes cancel and scrub snapshots. Resend retains its bounded idempotency key; SendGrid/SES can duplicate after ambiguous acceptance and do **not** promise exactly-once delivery. Throttle/auth/transient failures remain observable through safe queue status, attempt count and next availability; raw provider bodies and credentials are not persisted.

## Two-phase safety and upgrades

1. **Static preflight** validates original inputs, flags, literal grammar, supported connections, provider exclusivity/sender, secrets, ports and legacy selectors before deriving internal settings. Invalid static input causes **zero build, pull, container-create/start, migration, bucket, or provider operations**. Read-only Compose rendering is explicit and its secret-bearing output is suppressed. Inherited Compose files/profiles/project/env discovery cannot change topology.
2. **Container runtime checks** follow successful preflight. Images/containers may already exist. Existing application traffic/workers for the selected project are stopped before preparation. Credential-source resolution and read-only DB/schema/bucket checks gate traffic and worker claims; only afterward does authorized preparation run. A failure retains volumes and does not seed/reset/copy/delete data or broaden provisioning authority. Startup never sends an email permission probe.

Bundled PostgreSQL automatically runs tracked ordinary and semantic migrations before applications start. Semantic version/checksum tracking adopts compatible existing objects without resetting them; mismatches fail for operator inspection. Without an embedding key, ordinary full-text/fuzzy search works without external embedding requests.

External DB startup is **read-only by default**: pending ordinary migrations (including an absent ledger) refuse startup without creating a ledger/table. After reviewing/backing up your database, explicitly acknowledge ordinary migration changes for that invocation:

```sh
./deployment/local/start.sh --env-file /absolute/operator.env --ack-external-migrations
```

An env value cannot grant consent, and later invocations default to read-only again. External semantic capability/schema is a separate explicit prerequisite when `EMBEDDING_API_KEY` is configured: provision [`database/optional/semantic_search.sql`](../../database/optional/semantic_search.sql) deliberately with the database owner, not via automatic local startup. External buckets must already exist and be accessible; only the bundled store preparation step may create a missing bucket. API/worker startup verifies rather than infers creation permission from development mode.

For an old root `.env`, explicitly choose it or migrate values manually into the canonical local file. Remove `PORT`, old `SEAWEEDFS_*`, legacy selectors, and bundled-mode `DATABASE_URL`/`S3_*`; move local credentials to `LOCAL_*`. Add explicit provider and sender. Never copy over or automatically rewrite your original file. Changing env passwords does not rewrite initialized PostgreSQL users/volumes; repair credentials deliberately rather than deleting data. Back up valuable data before upgrading, inspect compatibility before downgrading, and retain existing volumes/CA. Startup performs no automatic rollback or schema downgrade.

## Trust HTTPS and inspect services

Export only the CA public root certificate, explicitly:

```sh
gateway=$(docker ps -q --filter label=com.docker.compose.project=chalktalk --filter label=com.docker.compose.service=gateway)
docker cp "$gateway:/data/caddy/pki/authorities/local/root.crt" /tmp/chalktalk-local-root.crt
```

Trust that public certificate in your OS/browser store. Never export `root.key` or mount private CA data on the host. The Caddy volume retains CA identity across restarts. Check `DOMAIN` matches your browser hostname. HTTPS health is `https://localhost:5173/api/health` by default; collaboration uses `/collaboration`.

Because runtime env files are private and temporary, use the launcher for startup rather than direct Compose commands. Inspect running containers by the explicit project label:

```sh
docker ps -a --filter label=com.docker.compose.project=chalktalk
api=$(docker ps -q --filter label=com.docker.compose.project=chalktalk --filter label=com.docker.compose.service=api)
docker logs "$api"
# Explicit ordinary stop; retains all named volumes (IDs below come only from Docker).
containers=$(docker ps -q --filter label=com.docker.compose.project=chalktalk)
[ -z "$containers" ] || docker stop $containers
```

Grafana is `http://127.0.0.1:3001` by default (`admin`, your `GRAFANA_ADMIN_PASSWORD`). Prometheus/Loki/Alloy and the existing VM dashboards remain part of the stack. The system dashboard measures Docker Desktop's Linux VM, not physical macOS or a managed DB server. See [observability](../../documentation/api/observability.md). Resource OCR remains fixed at 200 OCR pages and English Tesseract data; rate/OCR limits are code constants.

## Verification

Development checks (not operator-host prerequisites):

```sh
node --test deployment/local/tests/start.test.mjs
node --test deployment/local/tests/start.runtime.test.mjs
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The runtime suite owns distinct disposable projects/DB/storage and removes only its own fixtures. It does not send real mail or reuse the operator's default project. Never run live Resend acceptance checks as routine validation; any real inbox test requires separate explicit authorization.

## Importing a Piazza class

To populate a new installation with a real course, first create a normal ChalkTalk account, then import a Piazza class you belong to. Read the password without placing it in shell history:

```bash
api_container=$(docker ps -q --filter label=com.docker.compose.project=chalktalk --filter label=com.docker.compose.service=api)
export PIAZZA_EMAIL=you@school.edu
printf 'Existing ChalkTalk owner email: '; read -r CHALKTALK_OWNER_EMAIL
read -rsp 'Piazza password: ' PIAZZA_PASSWORD; printf '\n'
export PIAZZA_PASSWORD
docker exec -i \
  -e PIAZZA_EMAIL -e PIAZZA_PASSWORD "$api_container" \
  npm run db:import:piazza -- --owner "$CHALKTALK_OWNER_EMAIL" --class "CSE 416" --save piazza-cse416.json
unset PIAZZA_PASSWORD
```

Run this after the stack is up. `PIAZZA_EMAIL` signs in to Piazza; `CHALKTALK_OWNER_EMAIL` must be an existing ChalkTalk account and can be different. The API container already has the database connection and npm dependencies; `--save` writes into the repository's bind mount. To re-import a saved export, run `docker exec -i "$api_container" npm run db:import:piazza -- --owner "$CHALKTALK_OWNER_EMAIL" --from piazza-cse416.json`.

The `--owner` ChalkTalk account must already exist and becomes the course instructor; your own Piazza posts are attributed to it. Every other Piazza author becomes a course member with their Piazza name and role (professor → instructor, TA, student) and a placeholder `@piazza.invalid` email. These historical attribution accounts receive discarded random passwords; they are not shared demo logins. Questions, notes, instructor and student answers, followups and replies, folders (as tags), pins, endorsements, and helpful votes are imported with their original timestamps. Piazza HTML becomes Markdown, and images and attachments stay linked to Piazza. Polls become notes without their options. Piazza hides anonymous authors from students, so those posts belong to one shared "Anonymous Piazza user". A student account also sees only its own private posts and cannot read the roster or emails.

The command fetches one request per second, so a large class takes several minutes. Run it again at any time: matching Piazza ids add new content and refresh edited content without duplicating anything, and content deleted in ChalkTalk stays deleted. `--save` keeps the fetched data, and `--from piazza-cse416.json` re-imports from that file without contacting Piazza. Piazza has no public API; this uses the internal API its own website calls, which may change without notice.

### CI-owned transport fixtures

Existing CI browser and observability checks use `deployment/local/tests/ci-start.mjs` with an explicit `ct-modular-*` project. This development-only harness runs the canonical launcher and injects a test-only process preload into the owned API/worker commands. It accepts synthetic Resend sends in memory without provider network handoff; normal provider configuration still uses the official HTTPS origin. It is not imported by application startup and introduces no operator environment bypass. The harness requires development Node, unlike `start.sh`. Fixture inspection/teardown helpers refuse projects outside the reserved fixture namespace; CI cleanup is not product startup behavior.
