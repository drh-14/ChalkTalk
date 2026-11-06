## 1. Tests and configuration

- [x] 1.1 Write failing tests for `NODE_ENV=production` strict database/storage/Resend validation, local Resend credentials, and obsolete selector rejection.
- [x] 1.2 Implement environment selection and run focused tests red-to-green.

## 2. Deployment files

- [x] 2.1 Relocate local and production Compose, Dockerfiles, templates, and guide; preserve root Compose command and local data volumes.
- [x] 2.2 Remove normal Mailpit wiring, use Resend for local API/worker, and rebase all relative paths and references.
- [x] 2.3 Preserve ignored env secrets and permissions, without displaying or committing them.

## 3. Documentation and verification

- [x] 3.1 Update READMEs/CI and test both rendered Compose stacks and images.
- [x] 3.2 Run focused tests, typecheck, lint/format, archive OpenSpec, no-mistakes gate, and deliver one-commit draft PR.
