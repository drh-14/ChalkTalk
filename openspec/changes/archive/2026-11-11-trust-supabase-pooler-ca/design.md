## Context

The production API, worker, and collaboration images use Node 22; the migration job uses the API image. Supabase's IPv4 session pooler presents a chain rooted at Supabase Root 2021 CA, which is not in Node's default trust store. The downloaded PEM was verified against the current pooler hostname; it contains only a public certificate.

## Goals / Non-Goals

**Goals:** Consistent certificate and hostname verification for every production PostgreSQL client, including migrations; reproducible image builds and clear startup failure when trust material is absent.

**Non-Goals:** Changing local Compose, installing a VM-wide trust store, changing Supabase credentials, or running a production deployment from this PR.

## Decisions

- Commit the public CA under `deployment/production/` and copy it into each production Node runtime image. This makes the trust anchor part of the pinned release; a VM-managed file would add drift and a manual bootstrap step. Rotation requires a reviewed new commit.
- Set `NODE_EXTRA_CA_CERTS` to the copied PEM before Node starts and use `sslmode=verify-full`. This preserves Node's normal public roots for Resend HTTPS while adding the pinned Supabase root. Disabling certificate verification is not acceptable.
- Validate the PEM when building each image and require `verify-full` in the production database URL parser. Image build fails if the file is absent or malformed; config validation fails if a weaker mode is supplied.

## Risks / Trade-offs

- **CA rotation** → A future Supabase root change requires updating the committed PEM and rebuilding images. Monitor certificate validity and test the new chain before replacing it.
- **Existing production secret uses `require`** → Deployment fails until the operator updates it to `verify-full` and reruns VM bootstrap; document this sequence explicitly.
- **CA added to Node process trust globally** → This root is trusted by every TLS client in the three backend processes, not only PostgreSQL. It is a public CA dedicated to Supabase and was checked against the live pooler; avoid adding unrelated certificates.

## Migration Plan

Update the production GitHub environment's `DATABASE_URL` to the session-pooler URL with `sslmode=verify-full`, rerun bootstrap to refresh the VM env file, merge the PR, and allow the guarded main deployment. The old release is not marked successful; no schema rollback is involved.
