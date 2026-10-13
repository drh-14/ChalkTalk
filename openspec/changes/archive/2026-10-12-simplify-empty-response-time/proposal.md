## Why

The average response time card uses a large, bold sentence when no answers were endorsed in the selected period. That sentence overwhelms the other statistics and makes an empty metric harder to scan.

## What Changes

- Show `0` for the empty average response time state instead of the sentence.
- Render that `0` in the same size and bold weight as the other metric value.
- Clarify the metric caption as “Time from question to first endorsed answer.”
- Keep numeric response times and the API's `null` value unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-statistics`: Specify the empty response time presentation in the staff statistics tab.

## Impact

The statistics React view, its UI tests, and browser screenshots change. No CSS, API, database, or dependency changes are required.
