# ChalkTalk

ChalkTalk is a course discussion platform for students, teaching assistants, and instructors.

It is designed to make large course forums easier to search, organize, and maintain throughout a semester. Course post search combines full-text and fuzzy matching to help students find existing answers, including when a word is misspelled. Deployments can optionally add semantic matching to surface related questions and notes with different wording.

Students can ask questions, participate in threaded discussions, contribute to shared answers, search previous posts, view course resources, vote in polls, and optionally post anonymously.

Teaching assistants and instructors can collaboratively maintain staff answers, endorse correct responses, moderate discussions, organize posts with tags, manage course resources, and identify unanswered questions.

Core features include:

- course-based discussion forums,
- student, TA, and instructor roles,
- full-text and fuzzy post search with optional semantic matching,
- similar-question suggestions,
- collaborative student and staff answers,
- threaded follow-up discussions,
- endorsed answers,
- anonymous posting,
- Markdown and LaTeX support,
- image and document uploads,
- live code and whiteboard collaboration sessions,
- course resources,
- polls,
- notifications,
- optional per-course daily email summaries of qualifying previous-day activity,
- moderation tools,
- basic course statistics.

ChalkTalk's goal is to turn a semester's discussion history into a searchable and reusable course knowledge base rather than a collection of disconnected posts.

To manage your account, select your name in the signed-in top bar. Account settings lets you change your display name or password, manage each course's activity, announcement, and daily-digest emails, or delete your account after confirming with your current password. You can also change email choices in each course's settings. Deletion signs you out and leaves past contributions with your name removed. If you are a course's final instructor, assign another instructor before deleting your account.

## Team

- **Nicholas Smirnov** — authentication, authorization, security, account management, permissions
- **Khai Hern Low** — database design, semantic search, indexing, concurrency
- **Jackie Lee** — frontend, UI components, resources, notifications, responsive design
- **Darren Hamilton** — project management, testing coordination, documentation, integration

## Project map and documentation

The React/Vite client (`apps/web`) talks to the Express API (`apps/api`). PostgreSQL stores application data and background jobs; a separate worker sends mail and processes queued work. A collaboration server handles live-session WebSockets. Uploaded files use S3-compatible storage (SeaweedFS locally). See the [architecture diagram](diagrams/architecture/architecture.svg), [design](documentation/design.md), [database reference](documentation/database.md), and [API reference](documentation/openapi.yaml). The [`documentation/api/`](documentation/api/) directory explains individual API areas.

The Compose setup below is for **reproducible local development**. It includes a local mail sink, hot-reloading servers, and development credentials. It is not a production-hardened EC2 deployment; do not expose it publicly without replacing those settings, TLS termination, storage/backup, and SMTP configuration.

## Start locally

Run these commands from the repository root in a Bash-compatible shell (Windows users can use WSL). You need Node.js **22 or later**, npm, Docker with the Compose plugin (`docker compose`), and [`mkcert`](https://github.com/FiloSottile/mkcert#installation). The full-Compose path does not require Node.js on the host, but Node.js is needed for direct development and repository checks.

### 1. Create local configuration and HTTPS certificate

```bash
cp .env.example .env
mkcert -install                    # once per computer; installs a local trust root
mkdir -p .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem localhost
openssl rand -hex 32              # copy the output into AUTH_TOKEN_SECRET in .env
```

Edit the ignored `.env` before starting. At minimum, replace `AUTH_TOKEN_SECRET` with the generated value. Keep `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL` equal to the HTTPS URL you will open, and set `ALLOWED_SCHOOL_DOMAINS` to the domain(s) permitted to sign up (comma-separated, without `@`). The template's `example.edu` and local storage credentials are development placeholders, **not** deployment secrets. `.env` and `.cert/` are ignored by Git; never commit them.

For a repeatable local demo without creating accounts by hand, optionally set `MOCK_DATA=true` and `AMS161_DEMO_INSTRUCTOR_PASSWORD` (12–128 characters) in `.env` **before the first start**. Leave `MOCK_DATA=false` for an empty installation. See [Demo data](#demo-data) below.

### 2. Choose one run mode

**All services in Compose (recommended first run):**

```bash
docker compose --profile app up --build --wait
```

Compose starts PostgreSQL, Mailpit, SeaweedFS, a one-shot migration and optional seed, the API, background worker, collaboration server, and web client. The web client is [https://localhost:5173](https://localhost:5173). The first image build may take a few minutes. Re-running the command is safe: migrations are tracked and persistent data stays in named volumes. For foreground logs instead, omit `--wait`; inspect a service with `docker compose --profile app logs -f api` (or `web`, `worker`, `collaboration`, `migrate`).

**Services in Compose, application on your computer (fast edit loop):**

```bash
npm ci
docker compose up -d
set -a; source .env; set +a
npm run db:migrate
# Optional, only when MOCK_DATA=true: npm run db:seed:mock
npm run dev
```

Here Compose starts only PostgreSQL, Mailpit, and SeaweedFS. If you enabled mock data, run the commented seed command after migrations and before `npm run dev`. `npm run dev` starts Vite, the API, the worker, and the collaboration server together; use `npm run dev:web`, `dev:api`, `dev:worker`, or `dev:collab` to run one separately. The `source` command exports `.env` to migrations and all four local processes; run it again in a new terminal. Do **not** start the full Compose app profile simultaneously with `npm run dev`, or ports and workers will conflict.

### 3. Open the app and verify it

| Local endpoint                                   | Purpose                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| [https://localhost:5173](https://localhost:5173) | Web app; Vite proxies `/api` and `/collaboration`      |
| [http://localhost:8025](http://localhost:8025)   | Mailpit inbox for verification and notification emails |
| `http://127.0.0.1:8333`                          | SeaweedFS S3-compatible object store                   |
| `http://localhost:3000/health`                   | API health, **direct application mode only**           |

In full Compose mode, the API is not exposed on a host port; the web proxy exposes its health route at `https://localhost:5173/api/health`. Sign up using an address under `ALLOWED_SCHOOL_DOMAINS`, then open Mailpit to follow the verification link. Mailpit **does not deliver real email**. The collaboration WebSocket is reached through `wss://localhost:5173/collaboration`.

### Environment variables

Copying `.env.example` provides the local defaults. The table identifies what to edit and which settings Compose deliberately overrides inside its containers.

| Variable(s)                                                                         | Local purpose / required change                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_TOKEN_SECRET`                                                                 | **Required:** replace the template with a random secret of at least 32 characters; used to sign auth tokens.                                                                                                                                                                                              |
| `FRONTEND_ORIGINS`, `FRONTEND_BASE_URL`                                             | HTTPS browser origin(s) and canonical public URL. `FRONTEND_BASE_URL` must be one of `FRONTEND_ORIGINS`; defaults to `https://localhost:5173`. Update both if the host or `WEB_PORT` changes.                                                                                                             |
| `ALLOWED_SCHOOL_DOMAINS`                                                            | Comma-separated domains allowed to register, such as `school.edu`; no `@` prefix. `example.edu` is only a placeholder.                                                                                                                                                                                    |
| `DATABASE_URL`                                                                      | PostgreSQL connection used by **direct** local processes and migrations. The default matches Compose's local database. Full Compose overrides it with the internal `postgres` host.                                                                                                                       |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`                                | Direct mode sends to Mailpit at `localhost:1025` by default; `SMTP_FROM` is the sender shown in mail. Full Compose routes SMTP to its `mailpit` service. `SMTP_USER` and `SMTP_PASSWORD` are optional for an authenticated provider, but the supplied Compose file still overrides the host to Mailpit.   |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Direct mode uses local SeaweedFS at `127.0.0.1:8333`. Full Compose sets its internal endpoint and credentials from `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY`; these are **local object-store keys**, not AWS keys. Keep the direct-mode S3 keys in sync if you change the SeaweedFS keys. |
| `PORT`, `COLLABORATION_PORT`, `COLLABORATION_PUBLIC_URL`                            | Direct-mode API port (3000), WebSocket port (3100), and browser WebSocket URL. Full Compose sets its internal API port; the public WebSocket URL defaults to the frontend HTTPS host plus `/collaboration`.                                                                                               |
| `VITE_TLS_KEY_PATH`, `VITE_TLS_CERT_PATH`                                           | Direct Vite TLS files generated above. Full Compose mounts `.cert/` and supplies container paths.                                                                                                                                                                                                         |
| `MOCK_DATA`, `AMS161_DEMO_INSTRUCTOR_PASSWORD`, `AMS161_DEMO_STUDENT_PASSWORD`      | Optional local demo; `MOCK_DATA` defaults to `false`. The instructor password is required when true; the student password is optional. Both must be 12–128 characters.                                                                                                                                    |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`                        | Optional semantic search provider. Do not put the key in browser/Vite variables; private post text and search queries are sent to that provider. See [Optional semantic search](#optional-semantic-search).                                                                                               |
| `OBSERVABILITY_ENABLED`, `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_PORT`  | Optional local monitoring. When enabled, set the first to `true` and generate **different** random secrets for the token and Grafana password. Default Grafana host port is 3001.                                                                                                                         |
| `RATE_LIMIT_*`, `COLLABORATION_IDLE_END_MINUTES`, `LOG_SPOOL_DIRECTORY`             | Tunable API rate limits, live-session idle timeout, and observability log location. The `.env.example` defaults are suitable for local development.                                                                                                                                                       |

`WEB_PORT` is a Compose-only host-port override (default 5173), not an API variable. `COMPOSE_ENV_FILE` can point Compose services to another env file, but Compose variable interpolation also needs `docker compose --env-file <file>` or exported shell variables. Most teammates should simply use `.env`.

For **real email delivery** outside local development, configure a verified sender in `SMTP_FROM` and your provider's `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASSWORD`. The supplied Compose file **forces Mailpit** for app containers, so changing only `.env` will not send real mail; use a reviewed deployment override instead. Quote values with spaces (as `.env.example` does for `SMTP_FROM`) if you use the direct-mode `source .env` command. Never commit SMTP credentials.

### Demo data

With `MOCK_DATA=true` and `AMS161_DEMO_INSTRUCTOR_PASSWORD` set before a full-Compose start, the one-shot `seed-mock` service creates a local-only AMS161 course with instructor Maya Chen, a TA, students, questions, notes, answers, tags, and anonymous/pinned examples. Sign in as `maya.chen@ams161.mock.chalktalk.invalid` with the chosen instructor password. The course join code is `AMS16101`. `AMS161_DEMO_STUDENT_PASSWORD` optionally enables `riley.nguyen@ams161.mock.chalktalk.invalid`; other mock users receive discarded random passwords. Repeated runs do not reset credentials or overwrite user-edited content. Direct mode requires the explicit `npm run db:seed:mock` step above.

### Optional semantic search

Ordinary full-text and fuzzy search needs no external service. To add semantic matching, set `EMBEDDING_API_KEY` for an OpenAI-compatible embeddings endpoint in the ignored `.env` (and optionally `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`), then use the explicit pgvector override:

```bash
docker compose -f docker-compose.yml -f docker-compose.semantic.yml --profile app up --build --wait
```

This runs the optional vector migration. Do not switch an existing populated PostgreSQL volume between the ordinary and pgvector images without a migration/backup plan. Search falls back to lexical/fuzzy when the optional provider, key, or vector schema is unavailable.

### Optional local observability

Set `OBSERVABILITY_ENABLED=true` in `.env`, and set `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` to **different** outputs of `openssl rand -hex 32`. Then start:

```bash
docker compose --profile app --profile observability up --build --wait
```

Open Grafana at [http://127.0.0.1:3001](http://127.0.0.1:3001) and sign in as `admin` with `GRAFANA_ADMIN_PASSWORD`. Prometheus, Grafana, Logstash, and Elasticsearch run only with this profile. See the [observability reference](documentation/api/observability.md). Do not commit credentials or expose monitoring endpoints publicly.

### Stop, troubleshoot, and check changes

```bash
docker compose --profile app ps                   # service status
docker compose --profile app logs migrate         # migration failure details
docker compose --profile app run --rm migrate     # rerun tracked migrations
docker compose --profile app down                 # stop app and dependencies; keep data
docker compose down                               # stop dependency-only mode; keep data
```

`docker compose down --volumes` also **deletes local PostgreSQL, object-store, and other named-volume data**; use it only to intentionally reset the environment. If ports 5432, 5173, 1025, 8025, or 8333 are occupied, stop the conflicting service or configure an explicit port override. If HTTPS is untrusted, confirm `mkcert -install` ran and `.cert/localhost.pem` matches the hostname you opened. If API startup fails, inspect `migrate` and `api` logs before reseeding or deleting data.

Run the repository checks before submitting code:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Shared answer editing saves through REST: each member keeps a private draft until Save, and concurrent changes require an explicit version-checked overwrite. Followups and replies also use REST; there is no separate answer/followup WebSocket service.
