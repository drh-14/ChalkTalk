## Context

The root Compose file includes `deployment/local/compose.yml`. Application containers currently use an `app` profile, monitoring uses an `observability` profile, and the API waits for a `seed-mock` job. The seed job can create AMS161 and two committed Piazza exports. The explicit Piazza import CLI also reads a shared demo password. Existing local named volumes must not be reset by this change.

## Goals / Non-Goals

**Goals:** One default local Compose command; migrations but no startup seed; local monitoring included; explicit chosen-course import without demo credential settings.

**Non-Goals:** Deleting test fixture helpers, changing imported author attribution, provisioning real Piazza credentials, erasing existing local volumes, or changing production Compose.

## Decisions

- Remove `profiles` from the local app and monitoring services. This preserves one existing Compose topology rather than introducing an override. The required local `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` remain documented configuration.
- Remove `seed-mock` from Compose and make the API depend on `migrate`. Remove demo/mock settings from env templates and public local startup instructions. Test fixture functions may remain internal to tests; they no longer run as a deployment step.
- Remove `PIAZZA_DEMO_PASSWORD` from the public import CLI. The importer already generates random passwords when it is absent; retain that existing path. This does not grant login access to placeholder historical identities.
- Do not modify named volumes. On an existing local stack, prior demo courses remain until the operator intentionally resets the volume or deletes them in the app.

## Risks / Trade-offs

- [Heavier local startup] → Document that Grafana, Prometheus, Elasticsearch, and Logstash now start by default and list resource requirements.
- [Old sample data persists] → State that the change affects new databases only and provide the existing destructive reset command with a warning.
- [Imported historical accounts cannot sign in] → Document them as historical attribution identities; normal account creation remains separate.

## Migration Plan

Update local configuration and docs together. Validate Compose's default service list and a fresh disposable database. No schema migration is needed. Rolling back restores the old profiles and seed path without touching existing data.
