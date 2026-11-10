# Expose nonsecret Supabase Storage settings as environment variables

## Why
The production bootstrap currently stores Supabase Storage endpoint, bucket, and region as Actions secrets, though they are connection metadata rather than credentials. The operator wants those three settings alongside `DOMAIN` as visible configuration in the `production` GitHub environment.

## What Changes
- Read `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, and `SUPABASE_STORAGE_REGION` from `vars.*` in the manual `production` environment job.
- Keep private keys, database URL, auth secret, Resend key, SSH key, host, and pinned host identity in `secrets.*`.
- Keep runtime validation, rendered `production.env` names and permissions, fixed SSH 22, and VM behavior unchanged.
- Update documentation and executable workflow-contract tests.

## Impact
Only VM bootstrap workflow configuration, its tests, OpenSpec, and operator documentation change. Operators must move these three values to production environment variables and remove same-named repository-scoped fallback entries before first dispatch.
