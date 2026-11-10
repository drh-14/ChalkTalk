## Why

The VM bootstrap currently exposes generic `S3_*` Actions settings even though the production object store is Supabase Storage. The operator also has to configure an SSH port even though this VM uses the standard port 22.

## What Changes

- Rename the five VM-bootstrap Actions inputs and generated `production.env` keys to `SUPABASE_STORAGE_*`.
- Use SSH port 22 throughout the workflow, host-key validation, inventory, and UFW rule; remove `VM_SSH_PORT`.
- Bind the manual job to the GitHub `production` environment; read all bootstrap inputs from environment-scoped secrets except nonsecret `DOMAIN`, which is an environment variable. No required reviewers are added.
- Update offline tests and operator guidance. The production application/Compose consumer will be updated in a separate PR; this PR does not start it.

## Capabilities

### Modified Capabilities

- `vm-bootstrap`: Fixed SSH port and explicit Supabase Storage environment contract.

## Impact

Only the manual bootstrap workflow, Ansible config, its tests, and documentation change. The operator must configure the GitHub `production` environment secrets and `DOMAIN` variable before dispatch. No VM, Supabase, app runtime, or production Compose changes are made here.
