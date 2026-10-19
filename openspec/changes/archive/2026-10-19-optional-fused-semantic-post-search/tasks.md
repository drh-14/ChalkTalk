## 1. Contracts and red tests

- [x] 1.1 Update API, database, and OpenAPI references for optional semantic search and configuration.
- [x] 1.2 Add failing API/database tests for query validation, tiering, filters, pagination, fallback, and worker revision races.
- [x] 1.3 Add failing Related questions client and view tests for separate bounded `semanticQuery`.
- [x] 1.4 Specify and test transactional catch-up, in-flight backfill races, worker recovery, no-key writes, and lexical-only fallback.

## 2. Implementation

- [x] 2.1 Add optional pgvector provisioning and model-tagged chunk schema without changing ordinary migrations.
- [x] 2.2 Implement bounded OpenAI-compatible provider configuration, calls, validation, and fallback.
- [x] 2.3 Implement durable revision-safe worker indexing and backfill of question/note text.
- [x] 2.4 Integrate semantic candidate union and strict relevance tiers into post search and cursor binding.
- [x] 2.5 Send the separate semantic query from Related questions.
- [x] 2.6 Persist and drain per-post catch-up state and gate semantic search on indexing health.
- [x] 2.7 Reject stale semantic cursors and restart the filtered feed from page one.
- [x] 2.8 Own jobs and catch-up by embedding generation and skip blank chunks.
- [x] 2.9 Keep generation-scoped and no-key catch-up ownership distinct during rollout.
- [x] 2.10 Fan out no-key writes to registered generations without shared ownership.
- [x] 2.11 Bound generation heartbeats without serializing ordinary searches.

## 3. Verification and delivery

- [x] 3.1 Run focused and full API/web tests, lint, typecheck, and build.
- [x] 3.2 Run real PostgreSQL/pgvector and no-key PostgreSQL tests, plus mocked-API browser scenarios and screenshots.
- [x] 3.3 Archive OpenSpec, pass no-mistakes, publish a one-commit draft PR, and verify final-head CI.
