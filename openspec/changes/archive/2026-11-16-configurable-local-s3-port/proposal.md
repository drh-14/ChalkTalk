## Why

A local SSH tunnel already occupies port 8333, so the otherwise healthy Compose stack cannot start. Developers need to move only the host-side SeaweedFS port without changing its internal endpoint or persisted data.

## What Changes

- Allow a local Compose environment variable to select the loopback host port for SeaweedFS S3, defaulting to 8333.
- Keep the application's container-to-container S3 endpoint on port 8333.
- Document matching the host-side S3 endpoint and make the S3 smoke test follow the selected port.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-object-storage`: host S3 access may use an operator-selected loopback port.

## Impact

Local Compose configuration, its environment template and documentation, and Compose/S3 smoke tests. No production configuration, dependency, or public API change.
