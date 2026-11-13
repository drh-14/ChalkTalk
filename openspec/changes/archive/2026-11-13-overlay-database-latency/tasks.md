## 1. Dashboard

- [x] 1.1 Update dashboard tests to check the shared panels and series.
- [x] 1.2 Move database timing series to the matching HTTP panels.
- [x] 1.3 Verify the dashboard and capture a browser screenshot.

## 2. Critical endpoints

- [x] 2.1 Add failing dashboard tests for the endpoint-specific latency series.
- [x] 2.2 Add fixed-operation request-scoped query and pool totals with tests for concurrency, zero work, failures, aborts, and actual PostgreSQL activity.
- [x] 2.3 Add three charts with HTTP, query-total, and pool-total p50/p95 series.
- [x] 2.4 Verify the charts in a real browser and capture one screenshot per endpoint chart.
- [x] 2.5 Run focused and repository checks; resolve sandbox-only Docker build-context test failures with an elevated rerun.
