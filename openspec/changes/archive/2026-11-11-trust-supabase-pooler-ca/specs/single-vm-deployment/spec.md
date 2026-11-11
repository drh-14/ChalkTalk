## MODIFIED Requirements

### Requirement: Explicit managed data mode

The production Compose stack SHALL be located in `deployment/production/`, run application processes with `NODE_ENV=production`, and require the managed PostgreSQL, Resend, and `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY` settings. It SHALL not use custom `PRODUCTION`, `PROD`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` selectors. A managed `DATABASE_URL` SHALL specify exactly one `sslmode=verify-full` parameter. Missing, disabled, or weaker TLS modes SHALL fail startup.

#### Scenario: Managed database settings are missing

- **WHEN** a production process starts without a valid remote `DATABASE_URL`
- **THEN** it fails before serving work

#### Scenario: Managed database TLS mode is weaker than hostname verification

- **WHEN** a production process starts with `sslmode=require`, `sslmode=verify-ca`, or no TLS mode
- **THEN** it fails before connecting to the managed database with guidance to use `sslmode=verify-full`

#### Scenario: Managed storage settings are missing

- **WHEN** a production process starts without any required `SUPABASE_STORAGE_*` value
- **THEN** it fails before serving work with the missing variable's name

#### Scenario: Legacy storage settings are present without the new settings

- **WHEN** a production process has only the former `S3_*` values
- **THEN** it fails instead of silently using them

#### Scenario: Valid managed settings

- **WHEN** a production process starts with all five `SUPABASE_STORAGE_*` settings pointing to its database project's private storage
- **THEN** it uses those values for the existing S3-compatible client

#### Scenario: Legacy selector is present

- **WHEN** a removed custom mode selector is present
- **THEN** startup fails with guidance to remove it

#### Scenario: Local startup

- **WHEN** a local process starts without `NODE_ENV=production`
- **THEN** local PostgreSQL and SeaweedFS rules remain in effect

## ADDED Requirements

### Requirement: Verified Supabase database trust

Every production Node process that connects to Supabase PostgreSQL SHALL have the reviewed Supabase root CA available at startup and SHALL verify the pooler certificate chain and hostname. The system SHALL fail before serving work if the trust certificate is missing or malformed, rather than disabling verification.

#### Scenario: Production image is built with valid trust material

- **WHEN** the operator builds the API, worker, and collaboration production images from a pinned commit
- **THEN** each image contains the reviewed public root CA and its Node process loads that CA before connecting to PostgreSQL

#### Scenario: Trust material is missing or malformed

- **WHEN** a production image is built without a valid CA certificate
- **THEN** the build fails with a clear error instead of producing an image that bypasses certificate verification

#### Scenario: Supabase pooler certificate is valid

- **WHEN** the production process connects to the configured Supabase session pooler with `sslmode=verify-full`
- **THEN** it accepts only a certificate chain trusted by the bundled CA and matching the configured pooler hostname
