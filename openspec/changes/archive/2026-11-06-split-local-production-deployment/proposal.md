## Why

ChalkTalk currently mixes development and production deployment files and requires manual mode flags. Both environments now use Resend HTTPS; development retains local PostgreSQL and SeaweedFS while production uses Supabase. Separate directories make the two setups explicit without a custom mode switch.

## What Changes

- Put development deployment files in `deployment/local/` and VM deployment files in `deployment/production/`, preserving the root Docker Compose entry point.
- Use Resend HTTPS in both setups, requiring a verified sender and API key; remove Mailpit from normal local Compose.
- Use standard `NODE_ENV=production` for strict remote PostgreSQL/S3/Resend validation, with no `PRODUCTION`, `PROD`, or `LOCAL_*` mode flags.
- Retain existing `DATABASE_URL` and `S3_*` endpoint variables. Do not migrate data or add VM automation.

## Capabilities

### Modified Capabilities

- `single-vm-deployment`: Production stack is isolated and uses standard Node production mode.
- `local-object-storage`: Local stack retains SeaweedFS and its normal root command.
- `outbound-email-transport`: Both deployment stacks use Resend HTTPS.

## Impact

Compose, Dockerfiles, environment loading, templates, tests, and current setup documentation. No schema migration or new runtime dependency.
