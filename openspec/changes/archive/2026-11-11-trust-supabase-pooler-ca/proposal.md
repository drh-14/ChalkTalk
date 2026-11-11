## Why

The production migration container cannot verify the Supabase session-pooler's certificate, so deployment stops before the API starts. The app needs a reproducible trust anchor and an explicit hostname-verifying TLS mode.

## What Changes

- Bundle the downloaded public Supabase root CA in the three production Node images; the migration job reuses the API image.
- Require `sslmode=verify-full` for production database URLs and fail before database work if the bundled CA is missing or invalid.
- Update production setup guidance and tests. Local development and the frontend image remain unchanged.

## Capabilities

### Modified Capabilities

- `single-vm-deployment`: production database connections must verify the Supabase pooler's certificate and hostname using the bundled CA.

## Impact

Production image builds, API environment validation, deployment examples and tests. Operators must update the production `DATABASE_URL` secret from `sslmode=require` to `sslmode=verify-full` before the next deploy. No database migration or secret value is committed.
