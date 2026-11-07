## Why

The VM deployment currently bundles PostgreSQL and SeaweedFS and assumes SES SMTP, while production will use hosted Supabase PostgreSQL and S3-compatible Storage plus Resend HTTPS. Operators need an explicit, fail-fast local/managed choice without replacing ChalkTalk's API authorization or local development stack.

## What Changes

- Add strict `LOCAL_DATABASE` and `LOCAL_FILE_STORE` selectors. Local remains the default; managed mode requires explicit canonical `DATABASE_URL` and `S3_*` settings.
- Replace the deployment's multi-target image with four named frontend, API, collaboration, and worker Dockerfiles. The one-shot migration uses the API image.
- Remove local data containers from production Compose, keep local Compose local, and document a fresh Supabase setup and validation path.
- Configure production email for existing Resend HTTPS rather than SES SMTP.

## Capabilities

### Modified Capabilities

- `single-vm-deployment`: production topology, data providers, images, startup order and mail configuration change.
- `local-object-storage`: local development remains local and managed storage has an explicit fail-fast mode.

## Impact

Deployment Compose/Dockerfiles/env/README, local Compose environment, API config and tests, root README, OpenSpec references. No API contract, browser UI, or existing data migration changes.
