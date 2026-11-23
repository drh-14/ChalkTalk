# Local Object Storage Specification

## Purpose

Provide a persistent local S3-compatible object store for development and future file upload features without a cloud account.

## Requirements

### Requirement: Local SeaweedFS service

Local startup SHALL use `deployment/local/start.sh`. With `LOCAL_OBJECT_STORE_ENABLED=true` (default), it SHALL run persistent SeaweedFS and resolve its internal endpoint for applications independently of database selection. The S3 host endpoint SHALL be unpublished unless an optional loopback-only host port is requested. Existing named volumes SHALL be preserved.

#### Scenario: Bundled store with either database

- **WHEN** bundled storage is selected with either bundled or external PostgreSQL
- **THEN** applications use SeaweedFS internally, its existing data remains attached, and its host port is unpublished by default

#### Scenario: External store

- **WHEN** `LOCAL_OBJECT_STORE_ENABLED=false` and valid complete external S3 configuration is provided
- **THEN** no SeaweedFS service starts and applications use only the external store

#### Scenario: Developer starts default Compose services
- **WHEN** a developer starts the default local launcher with valid inputs
- **THEN** bundled PostgreSQL and SeaweedFS start and applications use their internal endpoints, with data host ports unpublished by default

### Requirement: Local object storage persistence

SeaweedFS SHALL retain object data across ordinary development Compose stop and restart operations.

#### Scenario: Developer restarts the stack

- **WHEN** a developer stores an object, stops the stack without deleting volumes, and starts it again
- **THEN** the object remains available from the S3 endpoint

### Requirement: Local S3 access configuration

Bundled storage SHALL use distinct `LOCAL_OBJECT_STORE_ACCESS_KEY_ID`, `LOCAL_OBJECT_STORE_SECRET_ACCESS_KEY`, `LOCAL_OBJECT_STORE_BUCKET`, and `LOCAL_OBJECT_STORE_REGION` inputs. External storage SHALL require complete `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`, with optional `S3_SESSION_TOKEN`. Bundled mode SHALL hard-fail on ANY populated supported external S3 field, including partial endpoint/bucket/region/credential/session inputs, before resolving internal S3 values. Generic `AWS_*` values SHALL NOT count as external S3 conflicts and SHALL NOT replace required explicit S3 credentials. External mode SHALL NOT fall back to bundled or ambient S3 credentials. Production SHALL retain its explicit same-project HTTPS `SUPABASE_STORAGE_*` configuration with no local/legacy/ambient fallback.

#### Scenario: Separate bundled credentials

- **WHEN** complete bundled credentials, bucket, and region are supplied without external S3 fields
- **THEN** SeaweedFS and applications receive matching resolved credentials and use the selected bucket

#### Scenario: Any partial external field conflicts

- **WHEN** bundled storage is enabled and any one supported external S3 field is populated
- **THEN** startup fails before mutation and names the conflicting field without printing its value

#### Scenario: AWS mail credentials coexist

- **WHEN** generic AWS credentials are present for SES default-chain with bundled storage
- **THEN** they do not cause an external S3 conflict and storage uses only its distinct local credentials

#### Scenario: Missing or invalid external configuration

- **WHEN** external storage lacks a required setting or supplies an invalid endpoint or incomplete credential pair
- **THEN** phase-1 startup fails before build/pull/create/start or any storage request, without ambient credentials or bundled fallback

#### Scenario: Production remains restricted

- **WHEN** production receives only `S3_*` or local storage inputs rather than required `SUPABASE_STORAGE_*` settings
- **THEN** it still fails under the existing managed-storage validation rules

#### Scenario: Developer connects with local credentials
- **WHEN** a developer explicitly publishes the bundled S3 loopback port and uses the documented `LOCAL_OBJECT_STORE_*` credentials
- **THEN** the S3-compatible endpoint accepts the authenticated request

#### Scenario: Operator selects managed storage
- **WHEN** production receives complete explicit `SUPABASE_STORAGE_*` settings
- **THEN** it uses those settings for the S3-compatible client under existing production validation

#### Scenario: Missing managed storage
- **WHEN** a required production `SUPABASE_STORAGE_*` setting is absent or invalid
- **THEN** startup fails clearly without local fallback

### Requirement: Bucket creation follows store ownership

After phase-1 static validation and phase-2 runtime checks, startup SHALL create a missing bucket only for the bundled object store. For external storage it SHALL verify the configured bucket exists and is accessible, fail actionably otherwise, and never attempt bucket creation. Ownership SHALL NOT be inferred from non-production mode or merely from an endpoint being set. No startup SHALL copy or delete objects. Credential validity, permissions and network failures SHALL be handled as phase-2 runtime failures before traffic/workers, not as a promise of zero container creation; failures SHALL NOT trigger unauthorized provisioning or destructive cleanup.

#### Scenario: Missing bundled bucket

- **WHEN** the selected bundled store reports the configured bucket missing
- **THEN** startup creates that bucket and continues without replacing existing data

#### Scenario: Missing or inaccessible external bucket

- **WHEN** the external store reports a missing bucket or denies access
- **THEN** startup refuses without a create/copy/delete request and without exposing credentials or raw provider details
