## 1. Contract tests
- [x] 1.1 Test resolved default Compose logging topology and security constraints; verify red against Elasticsearch stack, then green.
- [x] 1.2 Test Loki retention and Grafana Loki datasource/dashboard contract; verify red then green.

## 2. Local pipeline
- [x] 2.1 Add pinned Loki and Alloy configs and replace local Compose services; verify resolved Compose and container health.
- [x] 2.2 Update live smoke to prove sanitized ingestion, outage/restart catch-up, nonduplicate replay, retention, and Grafana query; verify against running stack.

## 3. Local setup simplification
- [x] 3.1 Test and derive local frontend URLs from DOMAIN while removing root template/PORT; verify Compose contracts.
- [x] 3.2 Remove obsolete demo seed modules/tests and preserve independent browser math rendering; verify browser test and empty-startup contract.
- [x] 3.3 Remove root Compose/ignore files, add Dockerfile-specific ignore rules, and update commands/CI with stable project name; verify image builds and context tests.

## 4. Documentation and delivery
- [x] 4.1 Update local observability docs and OpenSpec; verify references and strict OpenSpec validation.
- [x] 4.2 Exercise Grafana in a real browser and capture an uncommitted screenshot for PR attachment; verify UI and privacy edge case.
- [x] 4.3 Measure complete local stack memory and run focused and repository checks.
