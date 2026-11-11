## Why

Local development currently exposes Vite as the HTTPS proxy while production exposes Caddy. That routing difference obscures gateway bugs and requires manually generated local certificates. A local Caddy edge will make browser-visible routes representative of production while keeping Vite hot reload.

## What Changes

- Put Caddy in front of the local Vite, API, and collaboration services on the existing HTTPS `DOMAIN` and `WEB_PORT`.
- Generate and persist local TLS certificates automatically, with a documented one-time public CA trust step.
- Preserve Vite hot reload through the gateway; keep backend services private and narrow proxy trust and Vite host access.
- Remove the local Compose mkcert prerequisite and update CI, tests, and local setup instructions.

## Capabilities

### Modified Capabilities

- `local-compose-deployment`: local HTTPS ingress, route ownership, certificate generation, and development-server access change.

## Impact

Local Compose/Caddy configuration, Vite server configuration, local development docs, browser/Compose tests, and CI smoke workflow. Production deployment is unchanged.
