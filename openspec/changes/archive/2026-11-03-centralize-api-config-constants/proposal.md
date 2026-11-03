## Why

Rate-limit defaults are currently duplicated between API code and the environment template. Operators can inadvertently change security-sensitive limits via runtime variables. The frontend localhost defaults also live inline in the environment parser.

## What Changes

- Define the nine existing rate-limit values and localhost frontend URL defaults in one API constants module.
- Ignore legacy `RATE_LIMIT_*` environment variables while preserving the exact current limits.
- Keep `FRONTEND_ORIGINS` and `FRONTEND_BASE_URL` runtime overrides and validation.
- Remove obsolete rate-limit environment documentation and test the configuration contract.

## Capabilities

### Modified Capabilities

- `authentication`: API rate limits are code-controlled rather than environment-controlled; allowed browser origins remain deployment-configurable.

## Impact

Only API configuration and operator documentation change. No endpoint, database, or frontend behavior changes when using the documented defaults.
