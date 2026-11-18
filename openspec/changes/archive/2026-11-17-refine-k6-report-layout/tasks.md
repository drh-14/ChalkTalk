## 1. Specification and tests

- [x] Strict-validate proposal, delta spec, design, and tasks before code.
- [x] Write unit/query tests for Average labels, four client panels and two percentile-grouped database panels, second-level point hover and exact/near-overlap series tooltips, histogram PromQL, production-wide caveat, missing DB telemetry, sanitization, and one-unit axes.
- [x] Run real-browser assertions for desktop/mobile layout and capture both user-visible report screenshots.

## 2. Implementation

- [x] Extend bounded private Prometheus report queries to API DB-client query and pool-acquire p50/p95, grouping query and acquire lines by percentile and preserving per-run k6 checks.
- [x] Restyle static HTML to Grafana k6-inspired Overview/Timings hierarchy and responsive chart grid, with Average wording, accurate legends, and point-hover crosshairs and native tooltips.
- [x] Update the load-test runbook's report explanation and exclusions; do not add VM/system panels.

## 3. Verification and delivery

- [x] Run focused tests, report browser scenarios, lint, format, typecheck/build, and relevant repository checks; inspect screenshots.
- [x] Archive the validated OpenSpec change after checks pass.
