## 1. Contract and tests

- [x] 1.1 Validate the OpenSpec proposal, specification, design, and tasks with `openspec validate add-seaweedfs-compose --strict`.
- [x] 1.2 Add a test of the rendered Compose configuration for default startup, S3 host binding, credentials, and persistent volume; run it first and confirm it fails because SeaweedFS is absent.

## 2. Local storage service

- [x] 2.1 Add the pinned SeaweedFS service and named data volume to `docker-compose.yml`; verify the focused configuration test passes.
- [x] 2.2 Document local credentials, endpoint, and volume lifecycle in `.env.example` and `README.md`; verify Compose renders both fallback and overridden credentials.

## 3. Verification

- [x] 3.1 Start the default Compose stack, verify an authenticated S3 write/read survives a stop and restart, and confirm existing dependency services still start.
- [x] 3.2 Run relevant repository checks and strict OpenSpec validation, then archive the completed change.
