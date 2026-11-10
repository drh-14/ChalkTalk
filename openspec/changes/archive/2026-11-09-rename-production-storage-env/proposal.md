# Proposal

## Why

Production Storage settings currently use the generic `S3_*` prefix, making it easy to confuse Supabase production credentials with the local SeaweedFS settings. The operator chose explicit `SUPABASE_STORAGE_*` names for production.

## What Changes

- Production Compose, its environment template, and the API/worker configuration use `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY`.
- Production requires these values and never falls back to `S3_*`; existing same-project Supabase endpoint validation remains.
- Local development and SeaweedFS keep their existing `S3_*` settings.
- Update production deployment documentation and tests. The separate VM-bootstrap PR will render the same production names.

## Capabilities

### Modified Capabilities

- `single-vm-deployment`: explicitly named Supabase Storage settings in production.
- `local-object-storage`: local S3-compatible settings remain independent of production.

## Impact

Configuration and deployment contract only; no storage API, schema, file content, or browser behavior changes. Operators must rename the five production env entries before deploying this release.
