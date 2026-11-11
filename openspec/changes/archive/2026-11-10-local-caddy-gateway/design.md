## Context

See proposal.md. Existing Vite directly serves local HTTPS and proxies API/collaboration; production Caddy owns these routes. `WEB_PORT` and derived frontend URLs already exist, and CI exercises an alternate port.

## Goals / Non-Goals

**Goals:** route parity with production at the browser edge, Vite hot reload, automatic persistent local TLS, no new published backend port.

**Non-Goals:** production changes, replica scaling, static local frontend builds, automatic installation of a CA into each developer's host trust store.

## Decisions

- Add a local Caddy service and local Caddyfile, matching production route precedence but forwarding the fallback to Vite. Caddy handles WebSocket upgrades automatically. Reusing production Caddyfile would break HMR because its fallback serves static files.
- Run Vite over private HTTP with explicit empty TLS env values in Compose. Direct standalone Vite retains its current optional HTTPS/proxy settings. Configure HMR for the gateway's external WSS port and narrow allowed hosts to `DOMAIN`.
- Use `tls internal` and a named Caddy data volume. Developers export only `root.crt` to trust on their host. The private key remains in the volume. This replaces manual mkcert generation but cannot eliminate the one-time host trust step.
- Set API `TRUST_PROXY_HOPS=1` in local Compose to respect Caddy's forwarded client IP without trusting arbitrary extra hops.
- Exercise resolved Compose configuration, route/upgrade transport, HMR, alternate domain/port, restart persistence, and backend failures; retain mock API browser tests by default.

## Risks / Trade-offs

- Untrusted local CA on a fresh machine → document a one-time root-certificate export/trust step, without exposing private key.
- Vite or backend outage → health and route tests distinguish gateway from upstream failures.
- Local/production Caddyfile drift → transport tests cover shared route contracts.

## Migration Plan

Replace the local Compose setup and CI certificate step. Existing PostgreSQL/object-store volumes remain attached. Caddy gets a new named volume. To roll back, restore the prior local Compose/Caddy/Vite files; no data migration is involved.
