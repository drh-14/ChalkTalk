## MODIFIED Requirements

### Requirement: Request metrics and protected scrape

The API SHALL expose Prometheus request counts and duration histograms using only bounded method, matched route template, status class, and outcome labels. Buckets SHALL include 0.2 seconds. The metrics endpoint SHALL exist only when a valid `METRICS_TOKEN` and spool directory are configured and SHALL require that bearer token; health and scrape traffic SHALL not distort application latency. Production SHALL require those settings before serving work.

#### Scenario: Authenticated scrape

- **WHEN** a caller presents the correct bearer token to an enabled `/metrics`
- **THEN** Prometheus-format request and process metrics are returned

#### Scenario: Unauthorized or disabled scrape

- **WHEN** the token is absent or invalid, or observability is disabled locally
- **THEN** no metrics are disclosed

#### Scenario: Sensitive or unmatched path

- **WHEN** a request URL contains an identifier or query, or no route matches
- **THEN** no raw path, identifier, or query is used in a metric label

#### Scenario: Token-driven enablement

- **WHEN** a valid metrics token and spool directory are configured locally without an observability flag
- **THEN** protected metrics and sanitized event spooling are enabled

#### Scenario: No token in production

- **WHEN** a production API, worker, or collaboration process starts without a valid metrics token or required spool directory
- **THEN** startup fails before serving work

#### Scenario: Production monitoring remains off

- **WHEN** a production process receives an invalid metrics token or lacks its required spool directory
- **THEN** startup fails rather than exposing partially configured monitoring

#### Scenario: Protected production monitoring

- **WHEN** production starts with valid monitoring configuration
- **THEN** metrics and sanitized event spooling are enabled without publishing the metrics endpoints publicly

## ADDED Requirements

### Requirement: Private production monitoring dashboard

The production Compose stack SHALL run Prometheus, Loki, Alloy, and Grafana. Prometheus SHALL collect protected application metrics. Alloy SHALL ingest only sanitized API and worker spools without Docker socket access. Grafana SHALL load its administrator password from a separate private environment file that no application process receives. Only Grafana SHALL publish a loopback-bound host port; the monitoring stack SHALL have no public Caddy route. Loki SHALL retain logs for seven days and Prometheus SHALL retain metrics for fifteen days.

#### Scenario: Operator connects through SSH

- **WHEN** an operator forwards the VM's loopback Grafana port over SSH and signs in
- **THEN** provisioned dashboards and searchable sanitized logs are available

#### Scenario: Public or unauthorized access

- **WHEN** a remote client requests the Grafana port directly or a caller scrapes metrics without the token
- **THEN** telemetry is not disclosed

#### Scenario: Grafana password isolation

- **WHEN** production Compose creates the application and monitoring services
- **THEN** only Grafana receives the administrator password from its private environment file

#### Scenario: Collector outage

- **WHEN** Alloy or Loki is unavailable
- **THEN** application requests continue and surviving bounded spooled events can be replayed when the collector recovers
