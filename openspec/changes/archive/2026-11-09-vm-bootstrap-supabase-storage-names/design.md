## Context

VM bootstrap writes `/srv/chalktalk/shared/production.env` for a later production deployment. The current bootstrap input names are generic S3 names. The user selected explicit Supabase Storage names and a fixed SSH port of 22. The app/Compose consumer changes are intentionally separate.

## Decisions

- Map the five GitHub Actions secrets `SUPABASE_STORAGE_ENDPOINT`, `SUPABASE_STORAGE_BUCKET`, `SUPABASE_STORAGE_REGION`, `SUPABASE_STORAGE_ACCESS_KEY_ID`, and `SUPABASE_STORAGE_SECRET_ACCESS_KEY` to the same keys in the rendered env file. Do not emit old `S3_*` aliases.
- Bind the bootstrap job to the GitHub `production` environment. Use environment-scoped secrets for all inputs except `DOMAIN`, which is an environment variable; this includes `VM_HOST`, `VM_KNOWN_HOSTS`, SSH key, database, Storage, Resend, and auth values. The environment has no required reviewers, so manual dispatch is the only initiation gate.
- Remove the `VM_SSH_PORT` input. Validate an unbracketed `VM_HOST` pinned host-key line for port 22, write inventory without a custom port, and allow TCP 22 before enabling UFW.
- Leave the bootstrap VM-only. The production app and Compose currently consume generic S3 names; a follow-up PR must switch them before deploying from the new shared env file.

## Verification

Write failing tests first for the new Actions mapping, host-key rules, firewall port, and rendered env; then verify input rejection, template rendering, Compose parsing, Ansible syntax/lint, actionlint, and PR CI. Do not connect to or mutate the real VM.
