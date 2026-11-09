## MODIFIED Requirements

### Requirement: Local S3 access configuration

Local SeaweedFS SHALL use documented, overrideable development `S3_*` credentials. Production SHALL instead require explicit `SUPABASE_STORAGE_*` HTTPS endpoint, bucket, region, and credential pair, without local defaults, legacy `S3_*` fallback, or ambient credentials.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses documented local `S3_*` credentials against `127.0.0.1:8333`
- **THEN** the S3-compatible endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage

- **WHEN** a production process receives complete explicit `SUPABASE_STORAGE_*` settings
- **THEN** it uses those settings for its S3-compatible client

#### Scenario: Missing managed storage

- **WHEN** a required production `SUPABASE_STORAGE_*` setting is absent or invalid
- **THEN** startup fails clearly
