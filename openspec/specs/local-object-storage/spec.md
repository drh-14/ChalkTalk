# Local Object Storage Specification

## Purpose

Provide a persistent local S3-compatible object store for development and future file upload features without a cloud account.

## Requirements

### Requirement: Local SeaweedFS service

The default development Docker Compose startup SHALL use `docker compose -f deployment/local/compose.yml --env-file .env up --build --wait` from the repository root and run SeaweedFS with a host-accessible S3 endpoint on `127.0.0.1:8333`. The local Compose project SHALL preserve existing local volumes.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the default stack from the repository root
- **THEN** the local PostgreSQL and SeaweedFS services start and the app uses their internal endpoints

### Requirement: Local object storage persistence

SeaweedFS SHALL retain object data across ordinary development Compose stop and restart operations.

#### Scenario: Developer restarts the stack

- **WHEN** a developer stores an object, stops the stack without deleting volumes, and starts it again
- **THEN** the object remains available from the S3 endpoint

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
