## Context

The UFW task parses `ufw show added` on the target. On the live Ubuntu VM, UFW emits its usual header followed by `(None)` when there are no user rules. The current allowlist comparison rejects that marker.

## Goals / Non-Goals

**Goals:** Accept the exact no-rules marker and retain rejection of all unmanaged rules.

**Non-Goals:** Change firewall policy, remove rules, alter SSH access, or broaden the set of accepted ports.

## Decisions

- Treat `(None)` as an empty rule set only when it is the sole line after the expected header. Otherwise retain the existing exact allowlist comparison. This is safer than adding `(None)` to the allowlist, which would accept anomalous mixed output.
- Test the Ansible task through the existing mocked `ufw` executable so the public preflight behavior, not source text, is asserted.

## Risks / Trade-offs

- A future UFW version could change its output again. The preflight will fail closed, and a new observed format can be reviewed before support is added.

## Migration Plan

No migration. Deploy the updated workflow/playbook and rerun the manual bootstrap; its earlier package and environment setup is idempotent.
