## MODIFIED Requirements

### Requirement: Local SeaweedFS service

The local development Docker Compose startup SHALL run SeaweedFS with a host-accessible S3 endpoint bound to loopback. The host port SHALL default to 8333 and SHALL be configurable without changing SeaweedFS's container port or the application services' internal S3 endpoint. The local Compose project SHALL preserve existing local volumes.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the local stack without selecting a SeaweedFS host port
- **THEN** the local PostgreSQL and SeaweedFS services start
- **AND** SeaweedFS is accessible on `127.0.0.1:8333` and the app uses its internal endpoint

#### Scenario: Occupied default host port

- **WHEN** a developer selects an available alternate SeaweedFS host port
- **THEN** only the loopback host mapping changes
- **AND** the app still reaches SeaweedFS at its internal port 8333

### Requirement: Local S3 access configuration

Local SeaweedFS SHALL use documented, overrideable development `S3_*` credentials. A developer using a non-default SeaweedFS host port SHALL configure the host-side S3 endpoint to match it. Production SHALL instead require explicit `SUPABASE_STORAGE_*` HTTPS endpoint, bucket, region, and credential pair, without local defaults, legacy `S3_*` fallback, or ambient credentials.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses documented local `S3_*` credentials against the configured loopback host port
- **THEN** the S3-compatible endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage

- **WHEN** a production process receives complete explicit `SUPABASE_STORAGE_*` settings
- **THEN** it uses those settings for its S3-compatible client

#### Scenario: Missing managed storage

- **WHEN** a required production `SUPABASE_STORAGE_*` setting is absent or invalid
- **THEN** startup fails clearly
