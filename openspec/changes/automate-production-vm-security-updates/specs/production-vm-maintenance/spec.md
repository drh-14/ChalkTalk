## Purpose

Keep the production Ubuntu host security-patched under an explicit, non-rebooting policy and expose maintenance failures and deferred operator work without changing the application release lifecycle.

## ADDED Requirements

### Requirement: Security-only host package selection

Automatic maintenance SHALL run on supported Ubuntu 22.04, 24.04 and 26.04 using the existing APT maintenance mechanism. Its effective policy SHALL permit only the installed release's authenticated Ubuntu security archive and already-available Ubuntu ESM Apps/Infrastructure security archives. It SHALL NOT enable entitlements or repositories, allow the bare release archive, updates, proposed, backports or third-party origins, upgrade Docker CE/CLI/plugins, Docker distro variants, containerd or runc, perform release upgrades, update application dependencies/images, or run application/database migrations. Inherited configuration SHALL NOT widen eligibility. A security update needing a forbidden dependency SHALL be deferred and reported rather than widening the allowlist.

#### Scenario: Security and nonsecurity updates are available together

- **WHEN** authenticated package candidates exist from Ubuntu security, available ESM security, release, updates, proposed, backports and a third-party origin
- **THEN** a real unattended-upgrades dry run selects only permitted security candidates and excludes runtime packages even if a candidate is published in a permitted origin

#### Scenario: ESM is unavailable

- **WHEN** the host has no configured available ESM entitlement or source
- **THEN** ordinary Ubuntu security maintenance continues without attaching an entitlement or adding a repository and status identifies ESM as unavailable

#### Scenario: Forbidden dependency or policy drift

- **WHEN** a security fix needs an excluded dependency or effective configuration has been broadened
- **THEN** the dependency-bound fix is kept back, or the broadened-policy run refuses installation, respectively, and the check reports the condition without relaxing policy

### Requirement: Daily UTC maintenance with catch-up

Metadata refresh SHALL be scheduled daily at 03:00 UTC and security installation daily at 04:00 UTC, each with a randomized delay between zero and 30 minutes. Existing APT systemd timers SHALL remain the sole automatic runners. Inherited calendar entries and additional APT random sleeps SHALL NOT add alternative windows. Timers SHALL retain persistent missed-run catch-up, and installation SHALL follow metadata refresh, including after downtime. The window SHALL describe scheduled start, not completion time; catch-up SHALL be allowed outside the nominal window.

#### Scenario: Host uses a non-UTC local timezone

- **WHEN** both timers are inspected and run with a non-UTC local timezone
- **THEN** metadata and installation retain their UTC schedule, effective jitter and ordering without inherited extra events

#### Scenario: Host missed the scheduled window

- **WHEN** the timers reactivate after downtime spanning scheduled maintenance
- **THEN** they catch up without requiring another calendar day and installation does not use stale metadata

### Requirement: No automatic reboot and narrow restart deferral

Automatic maintenance SHALL explicitly disable automatic reboot with or without logged-in users. Normal eligible host service restarts SHALL be allowed, but needrestart SHALL NOT automatically restart Docker or containerd service units. Those units SHALL remain detectable for deferred-restart reporting. Docker live-restore SHALL remain unchanged. The feature SHALL NOT promise zero downtime or claim that suppressing needrestart controls every package maintainer script.

#### Scenario: Security updates leave reboot and runtime restart work

- **WHEN** installation requires a reboot or Docker/containerd processes use obsolete libraries
- **THEN** the host is not rebooted, needrestart does not restart those runtime units, live-restore is unchanged and the unresolved work appears in status

#### Scenario: Ordinary host service can be restarted

- **WHEN** an eligible non-runtime host service needs restart after a security update
- **THEN** restart policy permits the restart without globally disabling needrestart

### Requirement: Safe serialization and root-controlled update holds

Automatic metadata/installation SHALL coordinate with deployment through the existing host deployment flock, with at most 600 seconds waiting to acquire it, and SHALL retain it through completion of the package operation. Native APT/dpkg locks SHALL remain authoritative. Root-controlled persistent update holds SHALL prevent new automatic maintenance starts, not interrupt active work or block application deployment. Hold acquisition and release SHALL serialize through the same flock; each automatic runner SHALL check holds after acquiring it. A separate bootstrap hold SHALL prevent new automatic starts during bootstrap and SHALL persist on bootstrap failure for operator recovery. Holds SHALL not be writable by the deployment account, automatically expire, or silently clear previous operator holds. No wait timeout SHALL delete locks, kill package processes or interrupt a transaction.

#### Scenario: Hold requested during a transaction

- **WHEN** the operator requests an update hold while a package transaction holds the host lock
- **THEN** the transaction is allowed to complete and the hold request either obtains the lock and persists before acknowledging success or times out explicitly without claiming acquisition

#### Scenario: Hold appears while maintenance waits

- **WHEN** a maintenance runner waits for the host lock and a root-created hold exists by acquisition time
- **THEN** the runner reports held without starting a package operation or refreshing its last-success age

#### Scenario: Update hold and deployment remain independent

- **WHEN** only an update hold is present
- **THEN** new automatic maintenance is suppressed across reboots but an otherwise authorized deployment can proceed

#### Scenario: Bootstrap fails

- **WHEN** bootstrap fails after establishing its own maintenance hold
- **THEN** the marker persists, status reports it and rerun requires explicit recovery rather than silently clearing the hold

### Requirement: Trustworthy read-only maintenance status

The maintenance status interface SHALL be read-only and report all detected failures, stale or unknown maintenance, pending security fixes, reboot-required, deferred Docker/containerd restart, low disk, holds, and ESM availability. It SHALL distinguish actual successful metadata refresh/security evaluation (including no candidates) from failure, skips, held and running states. Only verified successful completion SHALL advance success timestamps; outer service exit zero alone SHALL NOT establish success. Policy drift, disabled timers, nonempty package audit, unavailable detectors or malformed evidence SHALL fail closed. Metadata or security-evaluation success older than 48 hours SHALL be stale; missing, corrupt or future timestamps SHALL be unknown. Disk SHALL be low below 2 GiB OR 10% available blocks, or below 10% free inodes, on distinct filesystems backing `/`, `/var` and `/srv/chalktalk`. Any actionable condition, hold, stale or unknown result SHALL produce a nonzero check result and all reasons, without automatic repair or secret disclosure.

#### Scenario: No candidates after successful evaluation

- **WHEN** metadata and actual security evaluation succeeded within 48 hours, policy/timers/audit/disk are healthy and no reboot, restart or hold is pending
- **THEN** status reports healthy even if no package needed upgrading

#### Scenario: Outer service succeeds but APT failed

- **WHEN** the outer daily service exits zero but package refresh or unattended evaluation lacks verified success evidence
- **THEN** status reports failed or unknown and does not advance the corresponding success timestamp

#### Scenario: Several operator actions are pending

- **WHEN** metadata is older than 48 hours, reboot-required exists, runtime restart is deferred and a monitored filesystem is below a threshold
- **THEN** status returns nonzero and reports all conditions with timestamps, thresholds and filesystem identifiers rather than stopping at the first error

#### Scenario: Status runs during held or active work

- **WHEN** maintenance is held or running and previous success is stale or failed
- **THEN** status preserves the stale/failure evidence, identifies the current disposition and does not invent a new successful completion

#### Scenario: Exactly at a threshold or evidence cannot be read

- **WHEN** success is exactly 48 hours old and disk is exactly at both block thresholds and the inode threshold
- **THEN** those boundaries alone are not stale or low
- **AND** missing, corrupt, future-dated or unreadable required evidence is reported unknown with a failing result

### Requirement: Scheduled trusted maintenance checks and operator notification prerequisites

A repository variable `PRODUCTION_VM_MAINTENANCE_CHECK_ENABLED` SHALL equal the exact string `true` before the production-contact job can execute, for both scheduled and manual events. Missing, false and every other value SHALL skip the job before production environment/secrets/SSH use. Merging SHALL NOT activate production maintenance checking. Implementation and delivery SHALL NOT set the variable or otherwise change GitHub settings. Only separate explicit operator authorization enables checking.

A daily 06:17 UTC GitHub Actions check and main-only manual check SHALL use the production environment, read-only repository permission, existing independently pinned port-22 SSH identity and the `chalktalk-production-vm` non-canceling concurrency group. It SHALL use only SSH-related secrets, run only trusted default-branch code, render a sanitized job summary and fail for actionable status or SSH/detector failure. It SHALL NOT refresh APT, mutate the VM, enable notifications/settings, invoke application mail/Resend, or introduce an external service. Operator enablement and a delivery test of GitHub Actions failure notifications SHALL be documented prerequisites rather than presumed configured guarantees. Production checking/activation SHALL require separate explicit authorization.

#### Scenario: Default-disabled rollout

- **WHEN** the feature is merged or manually dispatched and the opt-in variable is missing, false or not exactly `true`
- **THEN** the production-contact job is skipped without any SSH attempt, production secrets use or VM mutation

#### Scenario: Explicit opt-in

- **WHEN** a separately authorized operator sets repository variable `PRODUCTION_VM_MAINTENANCE_CHECK_ENABLED` to exactly `true` and the event uses trusted main code
- **THEN** the existing read-only status check may run subject to its production environment, pinned identity and concurrency safeguards
- **AND** implementation and delivery do not perform that enablement

#### Scenario: Host identity or status check fails

- **WHEN** SSH presents an unpinned host key, cannot connect, or returns a failing/unusable maintenance report
- **THEN** the job fails without bypassing host identity, installing tools, modifying host state or exposing secrets

#### Scenario: Check reports actionable maintenance

- **WHEN** the read-only check returns multiple actionable reasons
- **THEN** the job summary preserves all sanitized reasons and the workflow fails so operator-enabled GitHub failure notifications can apply

#### Scenario: Notification settings were never enabled

- **WHEN** the feature has passed disposable acceptance but the operator has not enabled and verified GitHub failure notifications
- **THEN** documentation marks notification readiness unverified and does not claim guaranteed alert delivery or send a Resend email

### Requirement: Executable supported-release acceptance before delivery

Acceptance SHALL execute in secret-free disposable Ubuntu 22.04, 24.04 and 26.04 environments with real systemd, APT, unattended-upgrades and needrestart. It SHALL prove effective merged policy, real dry-run origin/exclusion selection, timer scheduling/catch-up, no automatic reboot, restart behavior, locks/holds, read-only status/staleness and repeat-application idempotence. Source-text assertions alone SHALL NOT count as acceptance, and inability to run a release SHALL be reported as a delivery blocker, not skipped coverage. No acceptance operation SHALL target production.

#### Scenario: Default config would allow extra origins

- **WHEN** acceptance applies the policy over distro defaults and conflicting configuration fixtures on each supported release
- **THEN** the actual resolver dry run demonstrates the allowed candidates and exclusions, or policy verification fails closed before automatic installation

#### Scenario: Systemd is unavailable in the test guest

- **WHEN** a disposable guest cannot execute systemd as its init system
- **THEN** acceptance fails instead of substituting a mocked systemctl or claiming the release passed
