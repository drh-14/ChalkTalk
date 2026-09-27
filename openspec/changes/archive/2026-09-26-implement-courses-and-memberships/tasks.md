## 1. Persistence and domain

- [x] 1.1 Add forward-only course migration: creator backfill/failure, lifecycle fields, join code, role conversion, and membership revisions.
- [x] 1.2 Preserve `(course_id, user_id)` as the membership primary key and derive response IDs with UUIDv5.
- [x] 1.3 Add durable deletion jobs and an in-process leased worker.

## 2. API

- [x] 2.1 Implement direct organization listing required by course creation.
- [x] 2.2 Implement course create, organization/user list, detail, update, and asynchronous deletion.
- [x] 2.3 Implement join, member list/detail, role update, removal, leave, authorization, ETags, and final-instructor protection.
- [x] 2.4 Complete documented cursor/filter and idempotency behavior with PostgreSQL contract tests.

## 3. Browser experience

- [x] 3.1 Add the course API client and live protected course list.
- [x] 3.2 Add create, join, course detail, and instructor membership/lifecycle controls.
- [x] 3.3 Add rendered React/network tests for course workflows.

## 4. Validation

- [x] 4.1 Verify migration against PostgreSQL and retain existing auth integration coverage.
- [x] 4.2 Run complete workspace formatting, lint, typecheck, tests, build, and strict OpenSpec validation (2026-09-26: 85 tests including PostgreSQL integration; format, lint, typecheck, build, and strict OpenSpec validation passed; Compose browser-proxy smoke verified migration, create, cross-user join, async deletion, and polling to 404).
