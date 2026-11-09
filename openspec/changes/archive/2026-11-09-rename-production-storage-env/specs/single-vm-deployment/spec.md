## MODIFIED Requirements

### Requirement: Explicit managed data mode

The production Compose stack SHALL be located in `deployment/production/`, run application processes with `NODE_ENV=production`, and require the managed PostgreSQL, Resend, and `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY` settings. It SHALL not use custom `PRODUCTION`, `PROD`, `LOCAL_DATABASE`, or `LOCAL_FILE_STORE` selectors. A managed `DATABASE_URL` SHALL specify exactly one TLS mode (`sslmode=require`, `verify-ca`, or `verify-full`). Missing or disabled TLS SHALL fail startup.

#### Scenario: Managed database settings are missing

- **WHEN** a production process starts without a valid remote `DATABASE_URL`
- **THEN** it fails before serving work

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
