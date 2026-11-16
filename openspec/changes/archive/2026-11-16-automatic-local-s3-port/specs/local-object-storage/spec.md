## MODIFIED Requirements

### Requirement: Local SeaweedFS service

The local development Docker Compose startup SHALL run SeaweedFS with a host-accessible S3 endpoint bound to loopback. Docker SHALL automatically allocate an unused host port without changing SeaweedFS's container port or the application services' internal S3 endpoint. The local Compose project SHALL preserve existing local volumes.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the local stack without selecting a SeaweedFS host port
- **THEN** the local PostgreSQL and SeaweedFS services start
- **AND** SeaweedFS is accessible on a Docker-assigned unused loopback port and the app uses its internal endpoint

#### Scenario: Port 8333 is occupied

- **WHEN** a developer starts SeaweedFS while host port 8333 is occupied
- **THEN** Docker assigns an unused loopback host port
- **AND** the app still reaches SeaweedFS at its internal port 8333

### Requirement: Local S3 access configuration

Local SeaweedFS SHALL use documented, overrideable development `S3_*` credentials. A developer SHALL discover the published port using Compose and configure the host-side S3 endpoint to match it. Production SHALL instead require explicit `SUPABASE_STORAGE_*` HTTPS endpoint, bucket, region, and credential pair, without local defaults, legacy `S3_*` fallback, or ambient credentials.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses documented local `S3_*` credentials against the configured loopback host port
- **THEN** the S3-compatible endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage

- **WHEN** a production process receives complete explicit `SUPABASE_STORAGE_*` settings
- **THEN** it uses those settings for its S3-compatible client

#### Scenario: Missing managed storage

- **WHEN** a required production `SUPABASE_STORAGE_*` setting is absent or invalid
- **THEN** startup fails clearly
