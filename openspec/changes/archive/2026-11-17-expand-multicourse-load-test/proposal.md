## Why

The bounded production Ramp proves selected API capacity but its single-course read loop and sparse writes do not approximate ordinary course navigation or Thread activity. Operators also need readable, single-unit charts and a safe emailed copy of the report after cleanup.

## What Changes

- Give Ramp three isolated course cohorts and 10–30 gradually ramped synthetic users, with bounded post, answer, follow-up, vote, Thread, and resource-metadata journeys
- Enforce one global five-second minimum between intentional write-request starts, without retrying missed slots or ambiguous outcomes
- Extend manifest ownership, dependency inventory, row caps, and zero-residue teardown for three courses and Thread/resource rows
- Generate self-contained, separately scaled k6 HTML charts from bounded private Prometheus queries and email four individually attached sanitized reports only after verified cleanup
- Keep Smoke minimal; do not add collaboration, signup/email, upload/OCR/download, administration, or destructive operations to traffic

## Capabilities

### New Capabilities

None

### Modified Capabilities

- `bounded-load-testing`: Ramp behavior, fixture safety, artifact delivery, and evidence contracts change

## Impact

Touches the production load-test GitHub workflow, VM fixture CLI, k6 workload, report sanitizer/renderer/delivery scripts, tests, runbook, and OpenSpec. No public API or database migration is introduced. Production execution remains a separate operator decision.
