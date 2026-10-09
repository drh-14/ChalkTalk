## Why

Local development needs an object storage service available when Docker Compose starts. SeaweedFS provides a local S3 endpoint for future upload work without requiring a cloud account.

## What Changes

- Start a single SeaweedFS container with the default Compose stack.
- Expose its S3 endpoint on localhost and retain its data in a named Docker volume.
- Document the endpoint, local credentials, and startup behavior.

## Capabilities

### New Capabilities

- `local-object-storage`: Local Compose provides a persistent SeaweedFS S3 endpoint.

### Modified Capabilities

None.

## Impact

- Changes `docker-compose.yml` and local development documentation.
- Uses the upstream SeaweedFS Docker image. No ChalkTalk API or database contract changes are included.
