## Context

The workflow executes `deploy.sh` as `ssh ... 'bash -s -- stage SHA' < deploy.sh`. Docker Compose `run` keeps stdin open by default. After provider smoke prints success, it can drain lines that Bash has not yet read, so the pending marker and completion message are skipped while the stage exits zero.

## Goals / Non-Goals

**Goal:** Make stage completion deterministic when run through the workflow's SSH stdin transport.

**Non-goals:** Change smoke semantics, provider retries, deployment locking, or rollback policy.

## Decisions

- Detach the provider-smoke command from the deploy script's stdin. This preserves the existing SSH transport and the stage/finish protocol. Replacing the transport with a copied script would be a larger change.
- Add a public-seam regression test that invokes `bash -s` with the script as input and models a child that drains stdin. Assert the pending marker and finish result, rather than asserting a particular Docker flag.

## Risks / Trade-offs

- A future stage command could also read stdin. The regression test covers the current smoke command; deployment review must keep stdin ownership explicit for new interactive commands.
