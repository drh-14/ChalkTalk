## 1. OpenSpec artifacts

- [x] 1.1 Record the agreed target-schema scope and explicitly defer diagrams,
      migrations, and implementation.
- [x] 1.2 Define integrity decisions for course scope, tags, attachments,
      answer editors, and retained supporting tables.

## 2. Database reference

- [x] 2.1 Update identity, membership, idempotency, and rate-limit names and
      keys in `documentation/database.md`.
- [x] 2.2 Document normalized tags, direct course scope with composite foreign
      keys, explicit attachment parents, and answer contributors.
- [x] 2.3 Retain the agreed supporting tables and specialized collaboration
      model without changing diagrams or migrations.

## 3. Validation

- [x] 3.1 Run project-local Prettier, `git diff --check`, and focused schema
      searches; confirm only `documentation/database.md` changed outside this
      OpenSpec change.
- [x] 3.2 Validate this change with `openspec validate
reconcile-database-schema-reference --strict`.
