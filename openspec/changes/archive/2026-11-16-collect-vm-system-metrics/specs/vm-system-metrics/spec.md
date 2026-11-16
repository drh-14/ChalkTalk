## ADDED Requirements

### Requirement: Private host telemetry in both stacks

Production and local Compose SHALL run a pinned Node Exporter with read-only host filesystem, `/proc`, and `/sys` views. The exporter SHALL have no published host port and no Docker socket mount. Prometheus SHALL scrape it on the private Compose network every 60 seconds without changing the existing 15-day retention or application scrape jobs. Application availability SHALL NOT depend on exporter health. On macOS Docker Desktop, host series SHALL be described as Docker's Linux VM, not the physical Mac.

Production and local Compose SHALL also run a second pinned, private network-only Node Exporter with host PID visibility and a read-only `/proc` view rooted at host PID 1. It SHALL collect host network-device counters rather than its container network namespace, with no host networking, published host port, or Docker socket. Prometheus SHALL scrape it as a separate `chalktalk-vm-network` job every 60 seconds; network panels and freshness checks SHALL use that job.

#### Scenario: A stack starts with host collection

- **WHEN** production or local Compose starts its observability services
- **THEN** Prometheus can scrape Node Exporter over the internal network
- **AND** the exporter is not publicly or host-port reachable
- **AND** no Docker socket is available to it
- **AND** a separate private network collector reports host PID 1 network counters

### Requirement: VM System Load dashboard

Grafana SHALL provision a separate dashboard showing host CPU utilization, available and used memory, network receive/transmit and errors, disk I/O, and filesystem free capacity with appropriate units and labels. It SHALL distinguish VM host measurements from ChalkTalk process and DB-client latency. It SHALL NOT claim to show Supabase PostgreSQL server CPU, memory, or I/O.

#### Scenario: Operator reviews a load-test window

- **WHEN** an operator selects the run's UTC time window
- **THEN** the System Load dashboard shows host resource series alongside the unchanged application latency dashboard
- **AND** local Docker Desktop host labels identify the Docker Linux VM rather than macOS

### Requirement: Evidence-based scrape preflight

A private preflight SHALL reject a load-test readiness claim unless Prometheus reports `up=1` for API, worker, collaboration, and both Node Exporters and at least two recent one-minute samples of HTTP duration, DB query and pool-acquisition duration, host CPU idle, available and total memory, host-network receive and transmit, disk read and write, and filesystem available-capacity series after application warmup. It SHALL report which target or series is missing or stale and SHALL NOT treat a syntactically valid scrape configuration alone as proof of collection. Supabase server load requires separate manual Studio review.

#### Scenario: All metrics arrive

- **WHEN** the preflight runs after warmup and two scrape intervals
- **THEN** it reports app, DB-client, and host telemetry ready with fresh samples

#### Scenario: Exporter is up but host series are absent

- **WHEN** the exporter target is up but required host series are missing or stale
- **THEN** the preflight fails and the k6 ramp remains blocked
