## Why

Course staff cannot inspect the activity metrics described in the product design. Post views and answer contributions also lack durable events, so those metrics cannot yet be calculated accurately.

## What Changes

- Record one post view per signed-in member, canonical active post, and UTC date.
- Record answer creation and future content-edit contribution events.
- Add staff-only course summary and current-student statistics APIs for 7-day, 30-day, and course-to-date periods.
- Add a staff-only Statistics tab with daily activity, response time, and a paginated student table.
- Align statistics API and database references with the approved metric definitions.

## Capabilities

### New Capabilities

- `course-statistics`: Course-scoped recording, aggregation, access control, and statistics UI.

### Modified Capabilities

None.

## Impact

Database migration, post and answer services, course deletion job, API routes, course UI, API/OpenAPI/database documentation, and tests. No new third-party dependency or analytics service.
