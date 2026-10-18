## Why

The HTTP API currently polls PostgreSQL jobs in its own process. A dedicated worker keeps request serving independent of job processing and matches the existing deployment design.

## What Changes

- Move job polling from the HTTP server into a dedicated Node process, without changing the PostgreSQL job queue or direct authentication emails.
- Start that worker with local `npm run dev` and the Compose `app` profile, after migrations.
- Drain an in-flight job on shutdown and continue claiming queued jobs after restart.

## Impact

API and worker entrypoints, package scripts, Compose, local development instructions, and process-level tests. No database or HTTP API changes.
