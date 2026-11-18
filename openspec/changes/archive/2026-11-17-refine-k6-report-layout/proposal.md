## Why

The new sanitized k6 report is functional but visually sparse, and its legend uses “Mean” where “Average” is clearer. Operators also need API database-client query and pool-acquire latency beside k6 client latency to interpret a load test without switching views.

## What Changes

- Restyle the self-contained HTML report to resemble the familiar Grafana k6 report hierarchy and compact chart layout, with point-hover crosshairs and native tooltips, while retaining one unit and one Y axis per chart.
- Rename the report's “Mean” labels to accurate “Average” wording for the per-tag percentile aggregation.
- Add p50 and p95 API database-latency panels from private Prometheus for the exact run window, each with database query time and pool acquire time lines, clearly identified as production-wide rather than run-attributable.
- Keep CPU, memory, disk, and other VM/system metrics out of this report. Keep the existing original k6 export as artifact-only fallback.

## Impact

Changes the generated sanitized report, tests, and runbook only. No new service, dependency, production endpoint, or load-test traffic is introduced. The PR is stacked on the unmerged expanded k6 Ramp PR and remains draft until the user requests otherwise.
