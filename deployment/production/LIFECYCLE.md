# Lifecycle host integration

This interface is additive. It does not implement deployment/replacement activation,
maintenance holds, inventory, request staging, or the downstream receipt verifier.
No bootstrap/deploy callsites are changed in this lifecycle change.

## Provisioning invocation (security owner callsite)

Before Compose creates writer containers, as root, invoke the checked-out release:

```sh
bash /srv/chalktalk/current/deployment/production/setup-lifecycle.sh \
  /srv/chalktalk/shared/lifecycle 1000 1000
```

Use the actual non-root image UID/GID (the current Node images use 1000:1000).
The script is idempotent, refuses symlink/non-directory paths, creates a private
root-owned lifecycle root and per-role writer-owned 0700 requests/evidence
directories. It does not create/clear holds, acquire deploy.lock, activate a release,
change service state, or remove evidence. Do not invoke hold.sh while retaining
its internally acquired deploy.lock. Existing maintenance markers are not an
operation-CAS or lifecycle activation fence; do not auto-clear them.

Minimal serialized bootstrap/deploy callsite patch for the security owner:

1. Run the setup invocation before creating containers (not while holding a lock
   that the invoked helper itself acquires; this helper acquires none).
2. Build the actual release images and inspect each role's immutable image ID.
3. Set `LIFECYCLE_RELEASE_ID` to the deployed Git commit and the three
   `LIFECYCLE_{API,WORKER,COLLABORATION}_IMAGE_DIGEST` values to the exact inspected
   `sha256:...` IDs. Supply those values to Compose at container creation.
4. Start normally. An operator later binds an operation to the already-running
   boot by staging its private request and signaling it, not by relabel/restart.

The existing mutable image names are not evidence. A verifier must compare each
reported digest to inspected container image identity independently. Missing or
mismatched identity blocks replacement. Sample environment values are deliberately
not valid image identities. Do not activate the new production configuration
before the security-owned callsites provide this interface.

## Mounts and durable files

Compose binds `${LIFECYCLE_HOST_ROOT:-/srv/chalktalk/shared/lifecycle}/ROLE/requests`
read-only to `/run/chalktalk-lifecycle/requests`, and `ROLE/evidence` read-write to
`/var/lib/chalktalk-lifecycle/evidence`. Automatic host-path creation is disabled.
Every writer receives at least 150s container grace for the fixed 120s application
budget. No new control port, watcher, admin endpoint, dependency or lease reset.

Writer boot descriptor: `evidence/BOOT_UUID.boot.json`. Terminal receipt:
`evidence/BOOT_UUID.terminal.json`. `.reserved` and `.tmp` files are never proof.
The host stages `requests/BOOT_UUID.json` atomically before SIGTERM, with mode 0600
and writer-readable UID. Its strict schema is in the application lifecycle API
reference. Root may inspect evidence through the private parent directories.

Linux storage must support file fsync, same-directory atomic rename and directory
fsync. Successful files are insufficient without host-observed exit0. Missing
operation means ordinary shutdown and is ineligible for replacement. Keep the
Supabase replacement consumer paused until it verifies the exact producer contract
and all inventoried boots, exits and external writer fences. Production execution
is not authorized by these instructions.

## Consumer coordination fixtures

`tests/fixtures/lifecycle-replacement-evidence.json` supplies synthetic API replicas,
collaboration and worker boot/request/terminal tuples, independent expected host
inventory, observed-exit metadata, and explicit RFC6902 negative-case mutations.
The producer wire test executes real filesystem publication against each tuple.
These fixtures are not a replacement verifier or production evidence. The dependent
Supabase owner must implement and pass the negative mutations in its own namespace,
including omitted replica, observed exit, stale identity, OOM/KILL/restart,
visible-success/nonzero-exit and external-writer fencing cases. Synthetic consumer
compatibility checks do not establish live integration or external-writer fencing;
replacement remains paused pending those proofs.

For historical-release eligibility and the consumer proof boundary, see the
[application lifecycle reference](../../documentation/api/application-lifecycle.md#consumer-boundary-owned-by-replacement-integration).
