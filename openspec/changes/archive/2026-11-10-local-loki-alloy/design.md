## Context
The API and worker already write bounded, sanitized NDJSON spools. The default local Compose stack uses Logstash and Elasticsearch solely for local log search. Grafana and Prometheus already provide local dashboards and metrics.

## Goals / Non-Goals
**Goals:** Reduce local collector/store memory demand; retain outage replay, privacy properties, a searchable Grafana log view, and a single default Compose command.
**Non-Goals:** Changing production logging, application event schema, or migrating historical Elasticsearch data.

## Decisions
- Alloy tails the existing two spool volumes read-only using `loki.source.file`; its positions live in a dedicated persistent volume. This avoids a Docker socket or new application logging protocol. A Docker-log scraper was rejected because it would ingest unsanitized process output and require privileged socket access.
- Loki runs as a single binary with filesystem-backed TSDB and compactor seven-day retention. This is appropriate for a local single-host stack. A distributed Loki cluster was rejected as unnecessary.
- Grafana's existing logs datasource UID and dashboard panel switch to Loki/LogQL, preserving dashboard links while making queries compatible with Loki.
- Prometheus and Grafana remain default services. Old Elasticsearch/Logstash volumes are not removed, so rollback can restore the earlier Compose configuration.

## Risks / Trade-offs
- [Loki's filesystem storage is not byte-capped] → Retention limits age, while the test reports volume size; operators may prune old local volumes explicitly.
- [Collector outages can outlast spool retention/capacity] → Existing at-risk eviction metrics and smoke tests disclose that limit.
- [Docker VM memory may still be insufficient for the entire app] → Measure complete-stack startup on the 3.8 GiB VM rather than infer success from smaller component footprints.

## Migration Plan
Replace collector/store services in local Compose, keeping old volumes untouched. Roll back by checking out the preceding Compose configuration; prior Elasticsearch data remains in its volume.

## Environment simplification
The local template lives only in `deployment/local`, and the local Compose file is invoked explicitly rather than through a root wrapper. Compose derives frontend URLs from `DOMAIN` and `WEB_PORT`; production already derives from `DOMAIN`. Direct API tests keep explicit URL overrides. The app's internal port default remains 3000 with no local template or Compose `PORT` entry. Dedicated manual demo seed modules and their seed-specific tests are removed; an independent browser math-rendering fixture uses concise static test content instead of the old seeder.

## Canonical Compose and build context
Removing the root Compose wrapper would normally change the Compose project from `chalktalk` to `local`, detaching existing named volumes. The canonical file therefore declares `name: ${COMPOSE_PROJECT_NAME:-chalktalk}`; isolated tests can override the name. All local commands and CI jobs explicitly pass `-f deployment/local/compose.yml --env-file .env`. Dockerfile-specific ignore files replace the root ignore so both local and production root-context builds exclude secrets, Git metadata, installed dependencies, and sibling worktrees. The latter avoids accidentally embedding other worktrees in each image and reduces build pressure.
