## Context

PR #263 introduces a private Prometheus-backed, static HTML `report.html` with four single-unit panels. The existing Grafana Load Test Correlation dashboard already defines API DB-client query and pool-acquire histogram quantiles. The user wants a separate PR to make the report look closer to Grafana k6's HTML export without bringing back its mixed-unit axes, and explicitly declined VM resource panels.

## Decisions

- Reuse the existing report generator and private query-range tunnel; no new dependency or data source. Query the API histogram quantiles (`job="chalktalk-api"`) at p50/p95, using the dashboard's established five-minute rate window. Convert seconds to milliseconds once.
- Treat database-client panels as production-wide during the test window. They are not tagged by k6 run ID and can include other traffic. Never imply causality or per-request additivity.
- Reject missing/ambiguous required DB telemetry rather than charting zero; keep the existing screened original export as separate artifact-only fallback. Early no-traffic NaN samples may be omitted only for DB panels if at least two valid, ordered in-window samples remain.
- Borrow Grafana k6's white/pale-gray palette, Overview/Timings section hierarchy, two-column desktop chart grid, colored area/line series, quiet grid and time labels, and compact legend. Use point-hover SVG crosshairs and native tooltips with HH:mm:ss UTC time; combine coincident sample hit targets and give near-overlapping point targets a shared tooltip so every affected series value remains accessible, without scripts. Retain existing four k6 panels and add p50 and p95 database-latency panels, each with database query time and pool acquire time lines; no extra timing metrics or VM panels.
- Keep HTML static, responsive, self-contained, CSP-restricted, and without external scripts/assets. Use text labels and accessible SVG descriptions for the charts.

## Risks and mitigations

- Production-wide DB metrics may reflect concurrent unrelated traffic: the report labels their scope prominently and never describes them as k6-only.
- One-minute scrapes and short Smoke windows may lack enough valid histogram samples: fail report generation with a specific telemetry error; do not fabricate zero or silently substitute the original export.
- A visual-only layout could regress on narrow screens: verify desktop and mobile browser screenshots and readable labels.

## Rejected alternatives

- Reusing the built-in k6 report: it mixes units/Y axes, which the user explicitly rejected.
- Adding VM system panels: explicitly declined by the user for this report.
- Adding a charting library or remote assets: increases dependency/supply-chain and offline-report complexity for a static artifact.
