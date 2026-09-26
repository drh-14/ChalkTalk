# ChalkTalk

ChalkTalk is a course discussion platform for students, teaching assistants, and instructors.

It is designed to make large course forums easier to search, organize, and maintain throughout a semester. Unlike traditional discussion boards that rely mostly on keyword search, ChalkTalk uses semantic search and similar-question detection to help students find existing answers before creating duplicate posts.

Students can ask questions, participate in threaded discussions, contribute to shared answers, search previous posts, view course resources, vote in polls, and optionally post anonymously.

Teaching assistants and instructors can collaboratively maintain staff answers, endorse correct responses, moderate discussions, organize posts with tags, manage course resources, and identify unanswered questions.

Core features include:

- course-based discussion forums,
- student, TA, and instructor roles,
- full-text and semantic search,
- similar-question suggestions,
- collaborative student and staff answers,
- threaded follow-up discussions,
- endorsed answers,
- anonymous posting,
- Markdown and LaTeX support,
- image and document uploads,
- course resources,
- polls,
- notifications,
- moderation tools,
- basic course statistics.

ChalkTalk's goal is to turn a semester's discussion history into a searchable and reusable course knowledge base rather than a collection of disconnected posts.

## Team

- **Nicholas Smirnov** — authentication, authorization, security, account management, permissions
- **Khai Hern Low** — database design, semantic search, indexing, concurrency
- **Jackie Lee** — frontend, UI components, resources, notifications, responsive design
- **Darren Hamilton** — project management, testing coordination, documentation, integration

## Documentation

Detailed project requirements, user stories, scope, and architecture are available in the project documentation.

## Local development

Prerequisites: Node.js 22 or later, npm, and Docker with Docker Compose.

### Direct application development

Use this workflow for the fastest edit loop: Docker runs PostgreSQL and Mailpit, while the API and Vite development server run directly on your machine.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a trusted development certificate, configure your local environment, and start PostgreSQL plus Mailpit. The tracked `.env.example` is a safe local template; the copied `.env` and `.cert/` remain private to your checkout. Install [`mkcert`](https://github.com/FiloSottile/mkcert#installation) and run `mkcert -install` once before generating the certificate:

   ```bash
   mkdir -p .cert
   mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem localhost
   cp .env.example .env
   docker compose up -d
   ```

3. Apply database migrations:

   ```bash
   set -a && source .env && set +a
   npm run db:migrate
   ```

4. Start the web application and API:

   ```bash
   npm run dev
   ```

The React client runs at `https://localhost:5173`. Its `/api` requests are forwarded unchanged to the Express API at `http://localhost:3000`; use `https://localhost:5173/api/v1/...` for browser auth requests. Mailpit receives local SMTP mail at `localhost:1025` and displays it at [http://localhost:8025](http://localhost:8025). Keep `.cert/` private and configure a random `AUTH_TOKEN_SECRET` plus your real allowed school domains before deployment.

### Full-stack Docker development

After completing the certificate and `.env` setup above, start the hot-reloading web application, API, migrations, PostgreSQL, and Mailpit together:

```bash
docker compose --profile app up --build
```

The browser application is available at `https://localhost:5173`; its `/api` requests are proxied to the API inside the Compose network. The API intentionally has no host port. The `migrate` service waits for PostgreSQL health and completes before the API starts; rerunning it is safe because migrations are tracked. Compose automatically refreshes each container's named dependency volume when `package-lock.json` or the Node runtime changes; it never removes the PostgreSQL data volume.

If migration startup fails, inspect its logs, correct the underlying issue, then rerun it before starting the stack again:

```bash
docker compose --profile app logs migrate
docker compose --profile app run --rm migrate
```

Stop the full stack with `docker compose --profile app down`. The default `docker compose up -d` continues to start only PostgreSQL and Mailpit.

Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before submitting changes.
