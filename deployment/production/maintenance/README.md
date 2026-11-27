# Production VM security maintenance

This feature configures distro unattended-upgrades during an **explicitly authorized
bootstrap**. It is not active merely because its code is merged. Do not run
bootstrap or contact production as part of PR validation.

## Disabled rollout and notifications

The new maintenance SSH workflow skips its entire production job unless repository
variable `PRODUCTION_VM_MAINTENANCE_CHECK_ENABLED` is exactly `true` **and** its ref
is `main`. Missing, `false`, or any other value means no maintenance SSH attempt,
production environment entry, or production secret use. Manual dispatch has the
same gate. Implementation does not set this variable or change GitHub settings.

Only after separate production authorization: review/apply bootstrap, verify host
policy and maintenance evidence, enable GitHub Actions failure notifications and
verify receipt with a deliberately failing read-only check, then explicitly opt in
by setting that repository variable. Disable future checks by removing it or
setting it to `false`. Notification readiness is unverified until the operator
performs the delivery test. GitHub schedules/concurrency can delay checks; this is
not a guaranteed-time independent watchdog. No application email/Resend is used.

**Existing deploy-on-main is unchanged.** A future user-authorized merge can still
run normal deployment and contact the VM. This PR does not authorize merge,
production bootstrap, security-policy activation, or enabling the new check.

## Policy and operating limits

Only exact Ubuntu security archives and already-available authenticated ESM
security archives are eligible. No entitlement or repository is enabled. Release,
updates, proposed, backports, third-party, Docker/containerd/runc, images, app
packages, migrations, and OS release upgrades are outside automatic maintenance.
Existing package exclusions remain. Forbidden dependencies are deferred and
reported rather than broadening origins. Operator repository/key administration
remains a trust boundary: signed repositories can misrepresent Release metadata.

Metadata: daily 03:00 UTC. Security installation: daily 04:00 UTC. Each has 0–30
minutes jitter, persistent catch-up and no redundant APT sleep. Catch-up can run
outside those windows and refreshes metadata before installation. Normal host
service restarts are allowed; needrestart defers Docker/containerd without hiding
them. There is no zero-downtime guarantee. Automatic reboot, removals and mail are
disabled; Docker live-restore is not changed. Runtime security fixes/restarts and
reboots require separately authorized operator maintenance.

## Locks and holds

`/srv/chalktalk/shared/deploy.lock` is the single host serialization lock. Automatic
APT work, root hold controls, bootstrap coordination, and stage/finish wait at most
600 seconds to acquire it; the parent retains it until its child exits. Bootstrap
APT operations use a 300-second native package-lock wait. These bounds limit
**waiting**, not transaction runtime. Never delete locks, kill dpkg/APT, stop an
active package service, or clear a hold merely to make a check green.

The installed root-only interface is
`/usr/local/lib/chalktalk-maintenance/hold.sh set|clear update|deployment`.
Markers in root-owned `/var/lib/chalktalk-maintenance/` persist across reboots:

- `update.hold`: suppress new automatic metadata and install work, not deployment.
- `deployment.hold`: refuse new stage work before mutation and after lock waiting;
  already-staged finish bookkeeping remains permitted. Does not suppress updates.
- `bootstrap.hold`: invocation-token owned; suppress automatic work during bootstrap.
  A failure after its creation leaves it for explicit inspection/recovery. Rerun refuses to
  take over a previous marker. Clear only the appropriate token-owned marker
  after assessing the original failure; never clear operator holds automatically.

A hold request waits for active work and acknowledges only after its marker is
persisted under the lock. Timeout does not mean the hold was acquired. No marker
expires automatically. There is no general replacement/Supabase quiesce or
activation interface in this feature; those separate protocols need explicit
shared-seam agreement.

## Read-only status and evidence

`sudo -n python3 /usr/local/lib/chalktalk-maintenance/status.py` emits sanitized
version-1 JSON and exits nonzero for actionable, stale, unknown, held or failed
conditions. It does not refresh package lists, repair packages, clear markers,
restart services, or read production environment files. `--evaluate FILE --now N`
is an offline JSON assessment seam for tests, not the production SSH invocation.

A verified successful metadata refresh or security evaluation (including no
candidates) advances that operation's success time. Outer daily-service exit zero
alone is insufficient: its corresponding distro success stamp must advance.
Held/skipped/error operations do not refresh success age. Initial state is unknown,
not automatically healthy. Evidence is separate from current service disposition.

Stale means **older than** 48 hours; missing/corrupt/unreadable/future timestamps
are unknown. Low disk means available blocks below **2 GiB OR 10%**, or available
inodes below **10%**, deduplicated by backing filesystem for `/`, `/var`, and
`/srv/chalktalk`. Exact boundaries are not low/stale. Pending/deferred security,
reboot, runtime restart, policy drift, disabled/failed timers/services, package
audit problems and unavailable detectors all fail closed. All detected reasons
are reported together. ESM unavailability alone does not block ordinary security.

## Secret-free validation

Host unittest/syntax/lint checks and the nonprivileged process fixture supplement
rather than replace real acceptance. `maintenance-acceptance.sh` is guarded for
**disposable GitHub-hosted Linux CI runners only**. Its 22.04/24.04/26.04 matrix
uses ephemeral privileged systemd guests without host filesystem/Docker socket
mounts, production inventories, targets or credentials. Do not invoke it locally
by spoofing CI variables. Signed repositories and test SSH identities exist only
inside the disposable fixture. Synthetic ESM proves selection, not entitlement.
Unavailable release/systemd acceptance is a delivery blocker, never a skip/pass.
