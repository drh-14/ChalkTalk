## Context

The root development Compose currently includes local data and Mailpit; `deployment/` contains the production stack. A prior uncommitted proposal added a custom `PRODUCTION` flag. The requested design instead separates files by environment and uses Resend in both.

## Goals / Non-Goals

**Goals:** clear `deployment/local/` and `deployment/production/` topology, unchanged root startup command, fail-closed managed-service validation, and real Resend delivery locally.

**Non-Goals:** VM provisioning/deployment automation, data migration, changing mail triggers/recipients, or historical design documents.

## Decisions

- Relocate environment-specific files. Keep root `docker-compose.yml` as a thin local compatibility entry and preserve Compose project identity/volumes.
- Set `NODE_ENV=production` in production images and Compose. Production database/storage settings must be explicit remote TLS/S3 values. Local services use local endpoints.
- Local API and worker use Resend with ignored `RESEND_API_KEY` and verified `EMAIL_FROM`; no Mailpit service. SMTP transport code may remain for isolated tests, but production rejects an SMTP override.
- Keep CI deterministic by using a local mock Resend endpoint and dummy credentials. Manual live sends are opt-in and use a separately configured test recipient, never an inferred address.
- Preserve existing ignored env files securely while moving to canonical locations.

## Risks / Trade-offs

Local signup and reset now require a network connection and team-held Resend credentials. Development sends real mail, so test fixtures/CI must not use real provider credentials. Production setup still requires explicit Supabase and sender configuration.
