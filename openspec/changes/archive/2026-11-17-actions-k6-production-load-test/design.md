## Context

The approved architecture is recorded in `docs/design/2026-11-16-k6-production-load-testing.md` (2026-11-17 amendment). The existing PR has a privileged fixture CLI, bounded k6 script, loopback Prometheus receiver, and dashboard. This change replaces the local operator runner, not application API/database behavior.

## Decisions

- Use one `workflow_dispatch` workflow with explicit smoke/ramp input; require current `main`, `production` Environment, and `chalktalk-production-vm` queue.
- Normalize required Environment values to four integer stage minutes, capped fixed VU targets, and a 6–17 ramp-attempt allowance; fingerprint canonical JSON, and compare on the VM between dispatches.
- VM-side owner-only state is the authority for claims and smoke verification. Use a lock plus atomic replacement/fsync and fail-closed recovery; no production DB migration.
- Validate the two supported Storage S3 endpoint shapes and verified-TLS Supabase DB URL, and compare the GitHub DB secret to deployed VM URL through private files before fixture access.
- Keep the 0600 manifest on VM, transfer transiently to Actions, run k6 on the runner with only the fixed public API target, and upload only sanitized results. SSH carries remote write privately.
- Require successful per-operation coverage from the k6 summary; no extra load is permitted to satisfy a missing operation. Provision dashboard in `Load Tests`.

## Risks and mitigations

- Lost runner leaves a fixture: durable state and documented reviewed VM recovery, no retry under same ID.
- Secret disclosure via logs/artifacts: owner-only files, no URLs in argv/logs, positive report allowlist/secret scanning, finalizer removal.
- Wrong database: cross-check Storage ref, DB URL, deployed URL, current SHA before privileged operations.
- K6 noise: hard ceilings, one writer, check-based completion and aborts.
