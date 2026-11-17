# Proposal

## Why

ChalkTalk records application and DB-client latency but not actual Linux host load. A planned production k6 run needs correlated CPU, memory, network, disk, and filesystem evidence rather than interactive `top` snapshots. The production VM and local Compose share one Prometheus scrape configuration.

## What Changes

- Run a private Node Exporter in both production and local Compose, with read-only host views and no host port or Docker socket.
- Run a second pinned, private network-only exporter in both stacks using host PID 1's `/proc` network view rather than the container network namespace.
- Scrape it every minute into the existing 15-day Prometheus and provision a separate VM System Load Grafana dashboard.
- Verify fresh application, DB-client, and host series before treating a load-test window as observable.
- Document that Docker Desktop local host series describe its Linux VM, and that Supabase server metrics remain outside Prometheus.

## Capabilities

### New Capabilities

- `vm-system-metrics`: private host collection, visualization, and preflight.

### Modified Capabilities

None.

## Impact

Production and local Compose, the shared Prometheus scrape file, Grafana dashboard provisioning, deployment checks, operator documentation, and focused CI/runtime tests. No public API, application schema, Supabase secret, or k6 behavior changes. The second exporter adds one private scrape and no host port.
