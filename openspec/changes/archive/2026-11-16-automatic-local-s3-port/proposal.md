## Why

Fixed SeaweedFS host ports conflict with other local services. Docker should allocate an unused loopback port automatically.

## What Changes

- Publish container port 8333 on a Docker-assigned loopback host port.
- Remove the host-port setting and document port discovery for host clients.
- Preserve internal endpoints, credentials, and volumes.

## Capabilities

### Modified Capabilities

- `local-object-storage`: automatic host-port allocation.

## Impact

Local Compose, documentation, and tests only.
