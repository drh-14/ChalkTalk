## Why

Staff can inspect statistics in the browser, but cannot take the selected period's daily activity or full student roster into a spreadsheet. Copying the visible student page silently omits students beyond pagination.

## What Changes

- Add staff-only CSV downloads for daily activity and the complete current-student roster in the selected period.
- Add download actions to the Statistics tab and document the CSV endpoints and stable columns.
- Preserve existing period, counting, membership, and privacy semantics. No migration or new dependency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-statistics`: Staff can export daily and current-student statistics as CSV.

## Impact

Statistics service and HTTP routes, statistics tab, API/OpenAPI references, tests, and browser-flow screenshots.
