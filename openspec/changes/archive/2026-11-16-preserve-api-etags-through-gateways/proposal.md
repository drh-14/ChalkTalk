# Proposal

## Why

The two-browser collaboration test exposed an HTTPS gateway bug: compression rewrites an API ETag with a `-zstd` suffix, then the browser sends that value in `If-Match` and a valid End session request fails with 412. The production gateway has the same global encoding rule.

## What Changes

- Preserve API response ETags across local and production HTTPS gateways by excluding `/api/*` from gateway response encoding while leaving web-page encoding enabled.
- Keep versioned API reads usable as `If-Match` preconditions for collaboration and other optimistic writes.
- Verify the behavior through the real two-browser local-stack test and a production gateway configuration check.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-compose-deployment`: API ETags survive the local HTTPS gateway.
- `automatic-vm-deployment`: API ETags survive the production HTTPS gateway.

## Impact

Gateway Caddy configuration, focused gateway/Playwright tests, and deployment specifications only; no API schema, database, or frontend behavior change.
