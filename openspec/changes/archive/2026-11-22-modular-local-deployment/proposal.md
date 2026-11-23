## Why

Local Compose currently hardcodes both data services and Resend, overwrites operator connections, and can mutate schema before all configuration is validated. Operators need independently selectable bundled or external data services and explicit HTTPS mail selection without changing production deployment guarantees.

## What Changes

- **BREAKING (local only):** make `deployment/local/start.sh` the single startup entrypoint; keep deployment configuration, safe env template, instructions, and startup tests under `deployment/local/`.
- Default independent `LOCAL_DATABASE_ENABLED=true` and `LOCAL_OBJECT_STORE_ENABLED=true`; support all four topologies. Separate bundled credentials from external connections, reject even partial static configuration conflicts before any deployment mutation, and pass only resolved connections to applications.
- Use Docker/Compose and standard shell tools only on the deployment host. Phase 1 safely parses restricted literal configuration and validates it before build/pull/create/start; phase 2 checks credentials, connectivity and schema inside containers before traffic/workers or unauthorized provisioning. Keep SES credential providers refreshable in sending containers, never snapshot resolved credentials.
- Preserve stable project/volume identity, make optional data host ports loopback-only and unpublished by default, and neutralize inherited Compose file/profile overrides.
- Automatically apply tracked ordinary and semantic migrations only for bundled PostgreSQL. Require per-invocation acknowledgment for external ordinary migrations; otherwise check compatibility read-only. External semantic provisioning remains an explicit prerequisite. Create buckets only in bundled storage.
- **BREAKING (local only):** require `EMAIL_PROVIDER=resend|sendgrid|ses`, `EMAIL_FROM`, and exactly one complete provider configuration. Add HTTPS SendGrid and SES support with explicit SES credential modes, preserve existing auth mail and durable queue safety, and redact errors.
- Keep production Resend selection/fixed sender, managed data validation, TLS, auth, production deployment files, and UI unchanged.

## Capabilities

### New Capabilities

None; reuse existing capability paths.

### Modified Capabilities

- `local-compose-deployment`: canonical preflight-first launcher, modular topology, environment isolation, migration consent and compatibility.
- `local-object-storage`: separate local/external credentials, optional publication, bundled-only bucket creation.
- `outbound-email-transport`: local HTTPS provider selection and sender; provider-neutral frozen delivery and safe observable retries.

## Impact

Implementation will touch `deployment/local/` and necessary shared API environment, migration, storage, mail adapter, sender contract, worker and tests. Local deployment references in root README/deployment index and API/database references must stay accurate, without moving canonical local instructions outside `deployment/local/`. CI may invoke new local executable tests. `@aws-sdk/client-sesv2` is the sole approved new dependency; select a compatible version against the actual API workspace lock during implementation, not in planning. No new service, email gateway, SMTP path, automatic seed/reset/copy/delete, or exactly-once promise is introduced.

## Non-goals

No product code, dependency installation, container/service mutation, commit, PR, push, or OpenSpec archive in this planning phase. No frontend edits/mockups, production provider expansion, public API redesign, production migration-policy change, or live provider sends. Artifacts await user review and a separate apply request.
