## Tasks

- [x] Add failing integration coverage for initial enablement, model changes, restarts, concurrent writes, failed indexing, and separate generation workers.
- [x] Add generation-scoped durable completion migration and readiness/worker changes.
- [x] Run focused verification and archive the change.
- [x] Exercise HTTP semantic readiness through bounded backfill and matching-generation worker jobs without bypassing health.
- [x] Preserve PostgreSQL timestamp precision in bounded backfill cursors and cover more than one equal-microsecond batch.
