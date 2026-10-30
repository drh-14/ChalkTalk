## Why

The VM-specific production Compose stack does not match the chosen Railway deployment topology. Its public TLS, service startup ordering, and SES SMTP assumptions would be unsafe or unusable on Railway.

## What Changes

- Replace the VM Compose deployment with an exact Railway service/operator guide and variable template.
- Serve the built frontend and same-origin API/WebSocket routes through one Railway-facing HTTP Caddy gateway.
- Keep API, worker, collaboration, managed PostgreSQL, and persistent SeaweedFS private; use Resend HTTPS for production email.
- Require a single manually gated migration run before app rollout, and verify proxy, route, and WebSocket behavior.

## Capabilities

### New Capabilities

- `railway-deployment`: Runnable build targets, gateway behavior, private service configuration, and safe release procedure.

### Modified Capabilities

- `single-vm-deployment`: Retire the obsolete Compose, Caddy-managed TLS, and SES SMTP deployment requirements.

## Impact

`deployment/` documentation and gateway image/configuration, migration/operator checks, and deployment tests. Root development Compose and Mailpit remain unchanged. No database schema or application UI behavior changes.
