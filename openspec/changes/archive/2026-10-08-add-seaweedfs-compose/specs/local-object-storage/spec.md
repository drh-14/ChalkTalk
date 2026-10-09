## Purpose

Provide a persistent local S3-compatible object store for development and future file upload features without a cloud account.

## ADDED Requirements

### Requirement: Local SeaweedFS service

The default Docker Compose startup SHALL run SeaweedFS and make its S3 endpoint available to local development tools on `127.0.0.1:8333`.

#### Scenario: Developer starts default Compose services

- **WHEN** a developer starts the default Compose stack
- **THEN** SeaweedFS starts alongside the existing dependency services and its S3 endpoint is reachable on the host

### Requirement: Local object storage persistence

SeaweedFS SHALL retain object data across ordinary Compose stop and restart operations.

#### Scenario: Developer restarts the stack

- **WHEN** a developer stores an object, stops the stack without deleting volumes, and starts it again
- **THEN** the object remains available from the S3 endpoint

### Requirement: Local S3 access configuration

The local S3 endpoint SHALL require documented development credentials that developers can override without modifying tracked configuration.

#### Scenario: Developer connects with local credentials

- **WHEN** a developer uses the documented local credentials against `127.0.0.1:8333`
- **THEN** the S3 endpoint accepts the authenticated request
