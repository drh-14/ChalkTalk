## MODIFIED Requirements

### Requirement: Explicit managed data mode

The production Compose stack SHALL be located in `deployment/production/`, run application processes with `NODE_ENV=production`, and require the existing managed PostgreSQL, S3, and Resend endpoint/credential variables. It SHALL not use custom `PRODUCTION`, `PROD`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` selectors. A managed `DATABASE_URL` SHALL specify exactly one TLS mode (`sslmode=require`, `verify-ca`, or `verify-full`). Missing or disabled TLS SHALL fail startup.

#### Scenario: Managed database settings are missing

- **WHEN** a production process starts without a valid remote `DATABASE_URL`
- **THEN** it fails before serving work

#### Scenario: Managed storage settings are missing

- **WHEN** a production process starts without valid `S3_*` settings
- **THEN** it fails before serving work

#### Scenario: Legacy selector is present

- **WHEN** a removed custom mode selector is present
- **THEN** startup fails with guidance to remove it

#### Scenario: Local startup

- **WHEN** a local process starts without `NODE_ENV=production`
- **THEN** local PostgreSQL and SeaweedFS rules remain in effect
