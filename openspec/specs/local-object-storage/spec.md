# Local Object Storage Specification

## Purpose

Provide a persistent local S3-compatible object store for development and future file upload features without a cloud account.

## Requirements

### Requirement: Local SeaweedFS service

The default development Docker Compose startup SHALL run SeaweedFS and make its S3 endpoint available to local development tools on `127.0.0.1:8333`. Development app services SHALL explicitly set `LOCAL_FILE_STORE=true`.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the default Compose stack
- **THEN** SeaweedFS starts alongside the existing dependency services and its S3 endpoint is reachable on the host

### Requirement: Local object storage persistence

SeaweedFS SHALL retain object data across ordinary development Compose stop and restart operations.

#### Scenario: Developer restarts the stack

- **WHEN** a developer stores an object, stops the stack without deleting volumes, and starts it again
- **THEN** the object remains available from the S3 endpoint

### Requirement: Local S3 access configuration

The local S3 endpoint SHALL require documented development credentials that developers can override without modifying tracked configuration. Managed mode SHALL require an explicit HTTPS endpoint and credential pair rather than using local defaults or the SDK's ambient credential chain.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses the documented local credentials against `127.0.0.1:8333`
- **THEN** the S3 endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage

- **WHEN** `LOCAL_FILE_STORE=false` and complete explicit `S3_*` settings are provided
- **THEN** the application uses those settings for its S3-compatible client
