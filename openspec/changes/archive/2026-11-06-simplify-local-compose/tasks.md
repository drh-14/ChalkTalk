## 1. Contract and configuration

- [x] 1.1 Add failing resolved-Compose tests for pgvector migration and named local Dockerfiles, then verify the expected failures.
- [x] 1.2 Fold pgvector and semantic migration into local Compose, remove the separate semantic override, and verify resolved Compose and tests pass.
- [x] 1.3 Add four named local Dockerfiles, remove the generic development Dockerfile, and verify each image builds.

## 2. Documentation and validation

- [x] 2.1 Update the root/local READMEs and database reference; verify no current documentation points to the removed semantic override.
- [x] 2.2 Run ordinary and semantic migrations twice on a disposable pgvector database; verify extension and table exist.
- [x] 2.3 Run focused tests, format/lint, and Compose configuration checks; archive this change after verification.
