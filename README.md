# ChalkTalk

ChalkTalk is a course discussion platform for students, teaching assistants, and instructors.

It is designed to make large course forums easier to search, organize, and maintain throughout a semester. Course post search combines full-text and fuzzy matching to help students find existing answers, including when a word is misspelled. Deployments can optionally add semantic matching to surface related questions and notes with different wording.

Students can ask questions, participate in threaded discussions, contribute to shared answers, search previous posts, view course resources, vote in polls, and optionally post anonymously.

In a course's Resources tab, use **Search resources** just below the introduction to search by title or by words inside uploaded documents and images. Content matches become available after background text extraction; links match by title. While searching, creation tools are hidden. Select **Clear resource search** to return focus to the search field and restore the catalog and creation tools, with the sort, open edits, and unsaved form values preserved. TAs and instructors see indicators when a file's contents are pending or unavailable for search; the file can still be downloaded. See the [resource search reference](documentation/api/resources.md#searchCourseResources) for supported formats and search rules.

A passive new-post count shows how many matching posts arrived since the feed loaded without interrupting the current post or an unsent draft. A browser refresh loads the latest posts.

Teaching assistants and instructors can collaboratively maintain staff answers, endorse correct responses, moderate discussions, organize posts with tags and managed folders, manage course resources, and identify unanswered questions. Each post can have one optional folder, distinct from tags and course-resource sections; members can file their own posts, while staff manage folder names and can organize any post. Readers can select multiple folders in the feed sidebar, clear all selections to see posts with no folder, or explicitly choose All posts.

Instructors can turn off new anonymous or private contributions and pause follow-up resolution in a course's settings. Existing contributions and resolution markers remain visible to their authorized readers.

In course settings, an instructor must confirm the named member before removing them or the named course before deleting it. Cancel or Escape leaves it unchanged; if the course or membership changed meanwhile, review the refreshed details and confirm again before retrying.

Staff can pause new discussion and voting on an individual question or poll without hiding its existing content.

Core features include:

- course-based discussion forums,
- student, TA, and instructor roles,
- full-text and fuzzy post search with optional semantic matching,
- similar-question suggestions,
- collaborative student and staff answers,
- threaded follow-up discussions,
- [public course Threads](documentation/api/channels.md) for member conversations,
- endorsed answers,
- anonymous posting,
- private, autosaved drafts for unfinished new posts,
- Markdown and LaTeX support,
- image and document uploads,
- private live code and whiteboard sessions from each course's Collaboration tab,
- course resources,
- polls,
- notifications,
- optional per-course daily email summaries of qualifying previous-day activity,
- moderation tools,
- basic course statistics.

ChalkTalk's goal is to turn a semester's discussion history into a searchable and reusable course knowledge base rather than a collection of disconnected posts.

To manage your account, select your name in the signed-in top bar. Account settings lets you change your display name or password, manage each course's activity, announcement, and daily-digest emails, or delete your account after confirming with your current password. You can also change email choices in each course's settings. Deletion signs you out and leaves past contributions with your name removed. If you are a course's final instructor, assign another instructor before deleting your account.

When starting a post, your one private course draft is automatically restored. Text and post settings autosave across sessions; queued files are not saved with the draft and must be reselected after a reload. See the [post drafts reference](documentation/api/posts.md#private-new-post-drafts) for save, conflict, and archived-course behavior.

To delete a post you can read, open its detail view and select **Delete post**. The control is available to its author and current course TAs or instructors while the course is active, and asks for confirmation before deleting.

## Team

- **Nicholas Smirnov** — authentication, authorization, security, account management, permissions
- **Khai Hern Low** — database design, semantic search, indexing, concurrency
- **Jackie Lee** — frontend, UI components, resources, notifications, responsive design
- **Darren Hamilton** — project management, testing coordination, documentation, integration

## Project map and documentation

The React/Vite client (`apps/web`) talks to the Express API (`apps/api`). PostgreSQL stores application data and background jobs; a separate worker sends mail and processes queued work. The API handles Threads WebSockets; a collaboration server handles live-session WebSockets. Uploaded files use S3-compatible storage (SeaweedFS locally). See the [architecture diagram](diagrams/architecture/architecture.svg), [design](documentation/design.md), [database reference](documentation/database.md), and [API reference](documentation/openapi.yaml). The [`documentation/api/`](documentation/api/) directory explains individual API areas.

For the single-VM deployment with separate frontend, API, Hocuspocus, and worker images, managed Supabase PostgreSQL and Storage, and Resend HTTPS, see the [production Compose guide](deployment/production/README.md). The instructions below are for local development; they do not connect to Supabase.

The Compose setup below is for **reproducible local development**. It includes hot-reloading servers, local data services, and real Resend HTTPS email. Do not expose it publicly without replacing those settings, TLS termination, storage, backups, and email configuration.

## Start locally

Run these commands from the repository root in a Bash-compatible shell (Windows users can use WSL). You need an up-to-date Node.js **22** release, npm, Docker with the Compose plugin (`docker compose`), and [`mkcert`](https://github.com/FiloSottile/mkcert#installation). The full-Compose path does not require Node.js on the host, but Node.js is needed for direct development and repository checks.

### 1. Create local configuration and HTTPS certificate

```bash
cp .env.example .env
mkcert -install                    # once per computer; installs a local trust root
mkdir -p .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem localhost
openssl rand -hex 32              # copy the output into AUTH_TOKEN_SECRET in .env
```

Edit the ignored `.env` before starting. At minimum, replace `AUTH_TOKEN_SECRET` with the generated value and configure `RESEND_API_KEY` with your team key. Real verification and notification emails will be sent from ChalkTalk's fixed sender. Keep `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL` equal to the HTTPS URL you will open, and use a valid `.edu` address (including valid subdomains) for signup. The template's local storage credentials are development placeholders, **not** deployment secrets. `.env` and `.cert/` are ignored by Git; never commit them.

To populate ChalkTalk with existing course content, import a Piazza class explicitly after creating your account. See [Importing a Piazza class](#importing-a-piazza-class) below.

### 2. Choose one run mode

**All services in Compose (recommended first run):**

```bash
docker compose --profile app up --build --wait
```

Compose starts PostgreSQL, SeaweedFS, a one-shot migration, the API, background worker, collaboration server, and web client. The web client is [https://localhost:5173](https://localhost:5173). The first image build may take a few minutes. Re-running the command is safe: migrations are tracked and persistent data stays in named volumes. For foreground logs instead, omit `--wait`; inspect a service with `docker compose --profile app logs -f api` (or `web`, `worker`, `collaboration`, `migrate`).

**Services in Compose, application on your computer (fast edit loop):**

```bash
npm ci
docker compose up -d
set -a; source .env; set +a
npm run db:migrate
npm run migrate:semantic --workspace=@chalktalk/api
npm run dev
```

Here Compose starts only PostgreSQL and SeaweedFS. `npm run dev` starts Vite, the API, the worker, and the collaboration server together; use `npm run dev:web`, `dev:api`, `dev:worker`, or `dev:collab` to run one separately. The `source` command exports `.env` to migrations and all four local processes; run it again in a new terminal. Do **not** start the full Compose app profile simultaneously with `npm run dev`, or ports and workers will conflict.

For resource text extraction in direct mode, the worker also needs Poppler's `pdfinfo`, `pdftotext` and `pdftoppm`, plus Tesseract and English language data on `PATH`. The Compose images include these tools. If a tool or English language data is missing at startup, the worker logs `resource_text_tools_unavailable` and leaves extraction jobs pending until a corrected worker restarts; other job lanes continue.

### 3. Open the app and verify it

| Local endpoint                                   | Purpose                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| [https://localhost:5173](https://localhost:5173) | Web app; Vite proxies `/api` and `/collaboration` |
| `http://127.0.0.1:8333`                          | SeaweedFS S3-compatible object store              |
| `http://localhost:3000/health`                   | API health, **direct application mode only**      |

In full Compose mode, the API is not exposed on a host port; the web proxy exposes its health route at `https://localhost:5173/api/health`. Sign up using a valid `.edu` email address, then follow the verification link delivered to your inbox through Resend. The collaboration WebSocket is reached through `wss://localhost:5173/collaboration`.

### Environment variables

Copying `.env.example` provides the local defaults. The table identifies what to edit and which settings Compose deliberately overrides inside its containers.

| Variable(s)                                                                         | Local purpose / required change                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_TOKEN_SECRET`                                                                 | **Required:** replace the template with a random secret of at least 32 characters; used to hash and verify authentication-related tokens.                                                                                                                                                                 |
| `FRONTEND_ORIGINS`, `FRONTEND_BASE_URL`                                             | HTTPS browser origin(s) and canonical public URL. `FRONTEND_BASE_URL` must be one of `FRONTEND_ORIGINS`; defaults to `https://localhost:5173`. Update both if the host or `WEB_PORT` changes.                                                                                                             |
| `DATABASE_URL`                                                                      | PostgreSQL connection used by **direct** local processes and migrations. The default matches Compose's local database. Full Compose overrides it with the internal `postgres` host.                                                                                                                       |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_API_BASE_URL`                           | Local Compose selects Resend. Set a sending-only API key; the sender is fixed in code. `RESEND_API_BASE_URL` is only for isolated mocked-network tests. Production selects Resend through `NODE_ENV=production`.                                                                                          |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Direct mode uses local SeaweedFS at `127.0.0.1:8333`. Full Compose sets its internal endpoint and credentials from `SEAWEEDFS_ACCESS_KEY_ID` / `SEAWEEDFS_SECRET_ACCESS_KEY`; these are **local object-store keys**, not AWS keys. Keep the direct-mode S3 keys in sync if you change the SeaweedFS keys. |
| `PORT`, `COLLABORATION_PORT`, `COLLABORATION_PUBLIC_URL`                            | Direct-mode API port (3000), WebSocket port (3100), and browser WebSocket URL. Full Compose sets its internal API port; the public WebSocket URL defaults to the frontend HTTPS host plus `/collaboration`.                                                                                               |
| `VITE_TLS_KEY_PATH`, `VITE_TLS_CERT_PATH`                                           | Direct Vite TLS files generated above. Full Compose mounts `.cert/` and supplies container paths.                                                                                                                                                                                                         |
| `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`                        | Optional semantic search provider. Do not put the key in browser/Vite variables; private post text and search queries are sent to that provider. See [Optional semantic search](#optional-semantic-search).                                                                                               |
| `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_PORT`                           | Optional local monitoring. Set **different** random secrets for the token and Grafana password to enable the profile. Default Grafana host port is 3001.                                                                                                                                                  |
| `COLLABORATION_IDLE_END_MINUTES`, `LOG_SPOOL_DIRECTORY`                             | Live-session idle timeout and observability log location. API rate limits are fixed in `apps/api/src/config/constants.ts` rather than set through environment variables.                                                                                                                                  |

Resource OCR is limited to 200 PDF pages needing OCR per file and uses English Tesseract data, as fixed in `apps/api/src/config/constants.ts`; it does not use environment variables.

`NODE_ENV=production` is set by the production images/Compose and is not a custom user mode flag. `WEB_PORT` is a Compose-only host-port override (default 5173), not an API variable. For local Compose, `COMPOSE_ENV_FILE` can point services to another env file relative to the repository root, but Compose variable interpolation also needs `docker compose --env-file <file>` or exported shell variables. Most teammates should simply use `.env`.

For **real email delivery**, configure a sending-only `RESEND_API_KEY` for both API and worker. The sender is fixed as `ChalkTalk <notifications@joinchalktalk.com>` in API constants. Local Compose selects `EMAIL_PROVIDER=resend`. Use `RESEND_API_BASE_URL` only for isolated mock tests; omit it for real Resend. Queued retries use a frozen payload and stable Resend idempotency key; Resend’s bounded key window does not guarantee exactly-once delivery after expiry. For opt-out timing during delivery, see [course email preferences](documentation/api/courses.md#courseEmailPreferences). Never commit or share provider credentials.

For a **manual live Resend acceptance check**, start a disposable PostgreSQL server bound to loopback and set `TEST_DATABASE_URL` to its administrative database. Set `RESEND_LIVE_CONFIRM=send-synthetic-mail`, `RESEND_LIVE_RECIPIENT` to the approved test inbox, and the normal Resend variables, then run `npm run test:email:live`. The command creates and removes its own uniquely named database, sends no more than twelve synthetic messages, and refuses a non-approved recipient, remote database, or mock Resend endpoint. This command is never part of regular CI; it checks provider acceptance, not inbox arrival. See [live validation design](documentation/design/2026-11-02-resend-live-validation.md).

### Importing a Piazza class

To populate ChalkTalk with a real course, first create a normal ChalkTalk account, then import a Piazza class you belong to:

```bash
PIAZZA_EMAIL=you@school.edu PIAZZA_PASSWORD=... \
  npm run db:import:piazza -- --owner you@school.edu --class "CSE 416" --save piazza-cse416.json
```

The `--owner` ChalkTalk account must already exist and becomes the course instructor; your own Piazza posts are attributed to it. Every other Piazza author becomes a course member with their Piazza name and role (professor → instructor, TA, student) and a placeholder `@piazza.invalid` email. These historical attribution accounts receive discarded random passwords; they are not shared demo logins. Questions, notes, instructor and student answers, followups and replies, folders (as tags), pins, endorsements, and helpful votes are imported with their original timestamps. Piazza HTML becomes Markdown, and images and attachments stay linked to Piazza. Polls become notes without their options. Piazza hides anonymous authors from students, so those posts belong to one shared "Anonymous Piazza user". A student account also sees only its own private posts and cannot read the roster or emails.

The command fetches one request per second, so a large class takes several minutes. Run it again at any time: matching Piazza ids add new content and refresh edited content without duplicating anything, and content deleted in ChalkTalk stays deleted. `--save` keeps the fetched data, and `--from piazza-cse416.json` re-imports from that file without contacting Piazza. Piazza has no public API; this uses the internal API its own website calls, which may change without notice.

### Optional semantic search

The main local Compose stack uses PostgreSQL with pgvector and runs the vector migration alongside ordinary migrations. No separate semantic-search Compose file is needed. Ordinary full-text and fuzzy search still works without an external service. To add semantic matching, set `EMBEDDING_API_KEY` for an OpenAI-compatible embeddings endpoint in the ignored `.env` (and optionally `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL`), then start the usual stack with `docker compose --profile app up --build --wait`.

If you have an existing populated local volume created with the earlier `postgres:17-alpine` image, back it up before switching images. Search falls back to lexical/fuzzy when the optional provider or key is unavailable. Production remains separately configured against Supabase and does not run the optional vector migration automatically.

### Optional local observability

Set `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` in `.env` to **different** outputs of `openssl rand -hex 32`. The metrics token enables local monitoring without another switch. Then start:

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

`docker compose down --volumes` also **deletes local PostgreSQL, object-store, and other named-volume data**; use it only to intentionally reset the environment. If ports 5432, 5173, or 8333 are occupied, stop the conflicting service or configure an explicit port override. If HTTPS is untrusted, confirm `mkcert -install` ran and `.cert/localhost.pem` matches the hostname you opened. If API startup fails, inspect `migrate` and `api` logs before reseeding or deleting data.

Run the repository checks before submitting code:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Shared answer editing saves through REST: each member keeps a private draft until Save, and concurrent changes require an explicit version-checked overwrite. Followups and replies also use REST; there is no separate answer/followup WebSocket service.
