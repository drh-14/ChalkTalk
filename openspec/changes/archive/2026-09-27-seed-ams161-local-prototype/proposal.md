# Local AMS161 prototype data

## Why

The local full-stack prototype needs realistic Calculus II questions and confirmed duplicates for staff review. Manually creating accounts and posts on each fresh database is slow and inconsistent.

## What changes

- Add a one-shot local-only AMS161 fixture after migrations and before the API in the Compose app profile.
- Require explicit `MOCK_DATA=true` and a local instructor password; the tracked default and CI do not create fixtures.
- Create one loggable instructor, three non-login student authors, nine canonical questions, and three confirmed duplicates.
- Preserve the fixture unchanged on rerun, including edits and unmerges.

## Impact

No migration, external dependency, or production API contract change. Compose wiring, local documentation, and database-backed seed tests are added.
