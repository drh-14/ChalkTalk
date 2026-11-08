## MODIFIED Requirements

### Requirement: Request metrics and protected scrape

The API SHALL expose Prometheus request counts and duration histograms using only bounded method, matched route template, status class, and outcome labels. Buckets SHALL include 0.2 seconds. The metrics endpoint SHALL exist only when a valid `METRICS_TOKEN` is configured and SHALL require that bearer token; health and scrape traffic SHALL not distort application latency.

#### Scenario: Authenticated scrape

- **WHEN** a caller presents the correct bearer token to an enabled `/metrics`
- **THEN** Prometheus-format request and process metrics are returned

#### Scenario: Unauthorized or disabled scrape

- **WHEN** the token is absent or invalid, or observability is disabled
- **THEN** no metrics are disclosed

#### Scenario: Sensitive or unmatched path

- **WHEN** a request URL contains an identifier or query, or no route matches
- **THEN** no raw path, identifier, or query is used in a metric label

#### Scenario: Token-driven enablement

- **WHEN** a valid metrics token and spool directory are configured locally without an observability flag
- **THEN** protected metrics and sanitized event spooling are enabled

#### Scenario: No token in production

- **WHEN** production starts without a metrics token
- **THEN** its API and worker do not expose a metrics endpoint or event spool

#### Scenario: Production monitoring remains off

- **WHEN** production receives a metrics token by mistake
- **THEN** its API and worker still do not expose a metrics endpoint or event spool
