## Context

SeaweedFS binds host port 8333 directly, while app containers use `seaweedfs:8333`. An SSH tunnel on the host can occupy 8333 even when containers are healthy.

## Decision

Use `SEAWEEDFS_HOST_PORT` for the Compose `127.0.0.1:<host>:8333` mapping, defaulting to 8333 for compatibility. Keep the internal port and health check fixed. The local env template and README explain how to align host `S3_ENDPOINT`. The S3 smoke script reads the same variable. No port probing or automatic selection: operators must choose a free port explicitly, so the resulting endpoint is predictable.

## Alternatives

- Change the default port for everyone: breaks existing local clients unnecessarily.
- Automatically find a free port: makes the host endpoint non-deterministic and harder to configure.
- Use a personal Compose override only: fixes one checkout but leaves the documented conflict unresolved.
