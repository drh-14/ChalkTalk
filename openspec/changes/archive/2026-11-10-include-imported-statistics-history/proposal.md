## Why

Piazza imports preserve historical post and answer timestamps, but Statistics currently starts `course_to_date` at the new ChalkTalk course's creation date. Earlier imported activity is missing from daily totals and exports.

## What Changes

- Start `course_to_date` at the earlier of course creation and the course's earliest retained statistics-bearing activity date.
- Apply that same period boundary to summary, student statistics, and both CSV exports.
- Keep `7d`, `30d`, authorization, attribution, and response shapes unchanged.

## Impact

Statistics API, documentation, and tests. No database migration.
