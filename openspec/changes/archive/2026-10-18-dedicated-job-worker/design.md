## Design

`server.ts` only creates and listens with the HTTP app. A new `jobs/main.ts` entrypoint constructs the existing `JobWorker` with the same database, SMTP, and frontend URL configuration. A small polling runner serializes `runOnce` calls, waits on a timer when no job is available or a polling error occurs, and stops claiming work on SIGTERM/SIGINT. It lets the current claim finish before closing the PostgreSQL pool. Existing PostgreSQL leases recover a job if the process is killed without graceful shutdown.

Compose starts the worker after `migrate`, independently of API health. Root `dev` starts its watch process beside API and web. The worker has no HTTP port. The API stays healthy if the worker is unavailable; queued jobs remain in PostgreSQL.
