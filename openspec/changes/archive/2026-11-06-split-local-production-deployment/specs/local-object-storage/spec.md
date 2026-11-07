## MODIFIED Requirements

### Requirement: Local SeaweedFS service

The default development Docker Compose startup SHALL use `deployment/local/` and run SeaweedFS with a host-accessible S3 endpoint on `127.0.0.1:8333`. The root `docker compose` command SHALL remain usable and preserve existing local volumes.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the default stack from the repository root
- **THEN** the local PostgreSQL and SeaweedFS services start and the app uses their internal endpoints

### Requirement: Local S3 access configuration

Local SeaweedFS SHALL use documented, overrideable development credentials. The production stack SHALL require explicit HTTPS S3 endpoint, bucket, region, and credential pair rather than local defaults or ambient credentials.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses documented local credentials against `127.0.0.1:8333`
- **THEN** the S3 endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage

- **WHEN** a production process receives complete explicit managed `S3_*` settings
- **THEN** it uses those settings for its S3-compatible client

#### Scenario: Missing managed storage

- **WHEN** a required production `S3_*` setting is absent or invalid
- **THEN** startup fails clearly
