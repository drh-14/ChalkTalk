## Context

Local Compose already has Prometheus, Grafana, Loki, Alloy, dashboards, bounded sanitized API/worker spools, and protected metrics. Production explicitly disables telemetry and its Compose has only the app processes and Caddy. VM bootstrap allows SSH and web ports and writes a private env file.

## Goals / Non-Goals

**Goals:** Reuse the local observability stack privately on the production VM, retain its privacy boundaries, and make startup fail safely when required secrets are absent.

**Non-goals:** Public dashboard hosting, Caddy authentication, new firewall ports, alert delivery, Docker-socket log scraping, raw collaboration/Caddy log ingestion, Supabase-managed monitoring, or automatic VM bootstrap.

## Decisions

- **Private access:** Publish Grafana on `127.0.0.1:3001:3000`; access through SSH local forwarding over the existing port 22. Prometheus/Loki/Alloy stay on the internal Compose network. Bootstrap stores the Grafana administrator password in a separate mode-`0600` env file loaded only by Grafana, not the shared application env file. This is simpler and narrower than a public Caddy route protected by application or Cloudflare auth. Require Docker Engine 28 or later before starting this stack because older localhost port-publishing can leak to same-L2 hosts.
- **Telemetry control:** Production requires `METRICS_TOKEN` (at least 32 characters) and a writable spool directory, while local enablement remains token-driven. The first rollout PR adds `METRICS_TOKEN` and `GRAFANA_ADMIN_PASSWORD` to the VM bootstrap env file; this PR consumes them only after bootstrap is rerun.
- **Log privacy:** Reuse the API and worker's allowlisted sanitized event writer. Mount their separate named volumes read-only in Alloy; do not attach Docker socket or forward Caddy/collaboration raw stdout to Loki. Keep bounded Docker stdout as fallback.
- **Configuration:** Relocate local observability configs to shared `deployment/observability/`, then reference them from both Compose stacks to avoid drift. Use seven-day Loki and fifteen-day Prometheus retention, persistent Grafana/Loki/Prometheus/Alloy data, and existing dashboards.

## Risks / Trade-offs

- **Disk growth:** Loki's time retention does not cap bytes. Keep bounded spools and Docker log rotation; document disk checks and consider capacity monitoring later.
- **Localhost exposure:** Require Docker 28+ and test that Grafana has only a loopback host binding; no new UFW rule is added.
- **Secrets rollout:** If the app PR merges before a successful manual bootstrap after the first PR, automatic deployment fails. Gate this PR on the prior bootstrap and explicit VM rerun.
- **Collector outage:** Application availability must not depend on collector health. Reuse bounded spool and recovery behavior.

## Migration Plan

1. Merge the bootstrap-secret PR and manually rerun it after the two production environment secrets are set; verify the VM env file includes them without printing values.
2. Deploy this PR only after that verification. Compose creates new private observability volumes; no application database migration is needed.
3. Roll back the Compose/app release if necessary; preserve log/metrics volumes for diagnosis. No public firewall change is involved.
