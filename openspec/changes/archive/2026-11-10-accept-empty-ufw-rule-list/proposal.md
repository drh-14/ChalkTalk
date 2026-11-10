## Why

The first live VM bootstrap reached UFW but rejected an empty rule set because Ubuntu prints `(None)` after the `ufw show added` header. This blocks the approved clean-firewall setup without improving safety.

## What Changes

- Accept UFW's explicit `(None)` marker as an empty user-rule set.
- Continue rejecting any unmanaged deny, scoped, or other allow rule.
- Exercise both outcomes with the existing executable Ansible preflight tests.

## Capabilities

No requirement changes: the existing `vm-bootstrap` contract already allows an empty rule set and rejects unmanaged rules. This corrects its implementation.

## Impact

Only the Ansible firewall preflight and its tests change. No new dependencies, network exposure, or production env changes.
