## Why

Production needs repeatable security patching without silently upgrading the container runtime or rebooting the single application host. Operators also need an independent signal when maintenance fails, stops running, or leaves disruptive follow-up work.

## What Changes

- Extend existing Ansible bootstrap on Ubuntu 22.04/jammy, 24.04/noble, and 26.04/resolute to manage unattended-upgrades and the existing APT systemd timers. Permit only Ubuntu security and already-available ESM security origins; explicitly exclude other pockets, third parties, and Docker/containerd packages.
- Schedule security installation daily at 04:00 UTC with 0–30 minutes randomized delay, refresh metadata earlier, and preserve missed-run catch-up. Disable automatic reboot, permit ordinary host service restarts, and suppress needrestart-triggered Docker/containerd restarts without changing Docker live-restore.
- Bound bootstrap APT-lock waits and host deployment-lock waits. Coordinate automatic maintenance with deployment through the existing host flock and persistent root-owned update holds; keep deployment holds separate and never interrupt an active package transaction.
- Add a default-disabled scheduled read-only GitHub Actions maintenance check using existing pinned SSH and production concurrency. Report failures, stale maintenance, reboot required, deferred runtime restarts, and low disk. Rely on operator-enabled and verified GitHub failure notifications, not application email.
- Require tests-first behavior coverage and executable secret-free, disposable systemd acceptance on all three Ubuntu releases before delivery.

## Capabilities

### New Capabilities

- `production-vm-maintenance`: Security-only automatic host maintenance, safe holds/serialization, and read-only maintenance reporting.

### Modified Capabilities

- `vm-bootstrap`: Add bounded package-lock waits and establishment/verification of the managed maintenance policy without weakening existing bootstrap safety.
- `automatic-vm-deployment`: Add bounded host-lock waits and respect a separate persistent deployment hold without changing release trust, smoke checks, or finalization.

## Impact

Planned implementation touches `deployment/production/ansible/`, `deployment/production/deploy.sh`, focused production maintenance scripts/tests, `.github/workflows/vm-bootstrap-verify.yml`, and a new maintenance-check workflow. Reuse pinned Ansible tooling, shell/Python unittest, Docker and systemd; introduce no framework or external notification service. Detailed file ownership and ordered verification are in design/tasks.

Architecture, implementation plan and test seams are approved for implementation in the existing isolated planning worktree. Delivery is an independent one-commit draft PR based on current `origin/main`, with full no-mistakes and final-head CI verification. No production VM contact, configuration, secrets, live activation, reboot or GitHub settings changes are authorized.

Production checks remain disabled until explicit operator opt-in: repository variable `PRODUCTION_VM_MAINTENANCE_CHECK_ENABLED` must equal the exact string `true`. Missing, false or any other value skips the entire production-contact job before environment/secrets/SSH use, for scheduled and manual execution alike. Merging this feature must not initiate the new maintenance SSH check or activate its host security policy. Existing deploy-on-main is explicitly preserved: a future user-authorized merge may run the normal deployment workflow and contact the VM. No merge or live activation is authorized in this task. Do not set the variable as part of implementation or delivery. Existing deployment behavior is not activated or changed by this feature.

## Non-goals and protected work

No release upgrades, image rebuild policy, application dependency updates, migrations, zero-downtime guarantee, or automatic reboot. Do not edit the separate `openspec/replace-production-vm` scope (including any corresponding change directory), resume the user-paused deployment handoff guide, or alter other worktrees/branches. A minimal standalone maintenance operations note may be implemented later; it is not a replacement/deployment handoff guide.
