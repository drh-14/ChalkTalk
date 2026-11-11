## MODIFIED Requirements

### Requirement: Single-VM deployment topology

The system SHALL provide a separate Compose stack runnable on one Linux VM from a pinned source commit, with no development source mounts or mock seed. It SHALL connect to Supabase PostgreSQL and Supabase Storage rather than run local data containers, complete SQL schema migrations before compiled API, worker, and collaboration processes start, and serve the compiled browser application through Caddy. The frontend, API, Hocuspocus collaboration, and worker SHALL each have a separately named production Dockerfile; the migration job SHALL reuse the API image. Caddy SHALL be the only publicly published service; Grafana MAY publish a port bound only to VM loopback for SSH forwarding.

#### Scenario: Operator starts the deployment

- **WHEN** the operator supplies a valid deployment environment file and starts the deployment stack
- **THEN** migrations complete successfully before compiled application processes start
- **AND** only the Caddy frontend publishes public host ports 80 and 443
- **AND** Grafana is reachable only on VM loopback, while Prometheus, Loki, Alloy, API, and collaboration publish no host ports
- **AND** no PostgreSQL or SeaweedFS container is started in this stack
- **AND** backend processes can reach managed data services without exposing their own host ports
