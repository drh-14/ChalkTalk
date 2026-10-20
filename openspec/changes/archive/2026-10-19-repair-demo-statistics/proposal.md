## Why

The direct-SQL AMS161 seed bypasses activity tracking, so student statistics show zero despite seeded questions and answers. Math in fixture bodies also lacks the delimiters required by the existing renderer.

## What Changes

- Record timestamped question and answer contribution statistics during initial seeding.
- Repair an existing demo course only when both tracking tables are empty; otherwise preserve existing statistics and report the skipped repair.
- Format fixture math with supported LaTeX delimiters, for fresh fixtures and exact original existing fixture bodies; preserve user edits and endorsements.
- Preserve existing account credentials, user edits, course metadata, and actual view records.
- Add dedicated demo student Riley Nguyen with optional AMS161_DEMO_STUDENT_PASSWORD; safely add the reserved account/student membership to existing complete demos without resetting existing accounts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-prototype-fixtures`: Accurate fixture statistics and rendered math with conservative repeat-run repairs.

## Impact

AMS161 seed, integration tests, and browser verification. No schema, renderer, or public API changes.
