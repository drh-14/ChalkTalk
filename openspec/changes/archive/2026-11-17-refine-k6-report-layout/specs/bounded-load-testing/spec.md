## MODIFIED Requirements

### Requirement: Safe Actions evidence

The runner SHALL transiently transfer the owner-only manifest over pinned SSH, keep remote-write and report-query access private, and remove runner credentials in finalization. Only reports screened for credentials, nested fixture identifiers, response bodies, email addresses, and dynamic URLs SHALL become Actions artifacts. The run summary and scope file SHALL disclose selected ordinary-course coverage and excluded flows. The downloadable `report.html` SHALL be a self-contained HTML report with a Grafana k6-inspired Overview and Timings hierarchy and responsive compact chart layout. It SHALL keep each chart to one unit and one Y axis, display duration in milliseconds, and use “Average” rather than “Mean” for averages of tagged percentiles. It SHALL include separate API database-latency p50 and p95 panels, each with exactly two lines for database query time and pool acquire time at that percentile, using bounded private Prometheus queries for the same run window and explicitly identifying those series as production-wide rather than attributable only to k6. Hovering a plotted data point SHALL show a crosshair and native tooltip with its HH:mm:ss UTC time and series value; coincident points at the same timestamp and value SHALL share one hit target, and near-overlapping points at that timestamp SHALL expose all affected series values from each point target. It SHALL not include VM/system resource panels. The original screened k6 export MAY remain artifact-only as `k6-original.html` but SHALL NOT silently replace the custom report. Missing required series SHALL be reported as unavailable or fail report generation, not displayed as zero.

#### Scenario: Complete correlated report

- **WHEN** the run-scoped k6 and production-wide API database series are available within the bounded run window
- **THEN** the report shows separate client-latency, request-rate, HTTP-failure, active-user, p50 database-latency, and p95 database-latency charts, each database chart containing query-time and pool-acquire-time lines with correct units, labels, legends, and source caveat

#### Scenario: Missing database series

- **WHEN** DB-query or pool-acquire series are missing or ambiguous
- **THEN** the report refuses to represent missing values as zero and reports the missing telemetry distinctly

#### Scenario: Sanitized visual report

- **WHEN** a complete report is generated
- **THEN** it is self-contained, responsive, keyboard-readable as static content, and contains no external links, scripts, credentials, or fixture identifiers beyond the allowed run ID

#### Scenario: Unsafe report

- **WHEN** any report contains a manifest secret or nested private identifier
- **THEN** artifact upload and email of that report are refused

#### Scenario: Missing chart series

- **WHEN** a required run-scoped series is missing
- **THEN** report generation is incomplete, while independently safe summary and original-export evidence may remain downloadable
