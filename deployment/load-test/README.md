# Bounded production k6 test — GitHub Actions

This is a **manually dispatched backend-only HTTP API test of selected core flows**, not an automatic CI load test and **not all app flows**. It covers login; course, feed, post-detail, notification, and unread-count reads; and isolated question, note, answer, follow-up, poll, and vote writes. It does **not** cover course creation, files, email, or live collaboration. Fixture setup/cleanup is a separate privileged VM/database operation, not API traffic. The production API still uses Supabase PostgreSQL; Supabase server metrics are **not** scraped. Watch Supabase Studio manually.

## Before dispatch

Merge and deploy the reviewed change. The workflow is available only from current `main`, checks that the VM deployed SHA equals its checkout, uses the existing `production` Environment and pinned SSH host key, and serializes with deployment in `chalktalk-production-vm`. A dispatch before the matching release is deployed fails closed. It will never run on an ordinary push, PR, or deploy.

Set these **non-secret variables in GitHub’s `production` Environment** before dispatch; missing/invalid values fail before VM fixture access:

| Variable | Allowed value | Initial value |
| --- | --- | --- |
| `LOAD_TEST_MAX_VUS` | Integer 1–20; caps fixed targets 1→5→10→20 | `20` |
| `LOAD_TEST_STAGE_MINUTES` | Exactly four positive integer minutes, sum ≤10 | `1,3,3,3` |
| `LOAD_TEST_RAMP_WRITE_ATTEMPTS` | Integer 6–17 | `17` |

Existing `production` `DATABASE_URL` secret and `SUPABASE_STORAGE_ENDPOINT` variable must describe the **same Supabase project** and match the VM’s deployed `production.env` URL. The workflow checks exact project/host/TLS shape and compares the URLs privately before provisioning; it does not independently prove the project is the one you intend. Confirm that project in Supabase Studio. Existing SSH secrets (`SSH_PRIVATE_KEY`, `VM_HOST`, `VM_KNOWN_HOSTS`) are used; no new project-identity secret is needed.

Choose a fresh ID matching `load-YYYYMMDD-<8–32 lowercase letters/digits>`, e.g. `load-20261117-a1b2c3d4`. Confirm healthy API/worker/collaboration/Node Exporter scrapes, VM memory/disk, dashboard access, and a healthy Studio baseline. Do **not** start with an active Supabase memory warning without an explicit headroom/stop decision. Schedule an operator window; a person must watch Grafana and Studio and cancel on a safety signal.

## Smoke dispatch and review

From GitHub Actions, open **Bounded production load test → Run workflow**, select `main`, `mode=smoke`, and the unique run ID. Or run:

```bash
gh workflow run load-test.yml --ref main -f mode=smoke -f run_id=load-20261117-a1b2c3d4
```

The VM atomically consumes the smoke attempt **before** fixture provisioning or traffic. It creates 20 synthetic verified users, one isolated organization/course, and prerequisite question/poll, with fixture email preferences disabled. No public auth bypass is added. The runner receives the 0600 manifest transiently over pinned SSH. One VU logs in once, retains cookie/CSRF, reads the selected routes, and makes one protected vote. A successful checked response is required for every smoke operation. The runner sends k6 metrics through a private SSH tunnel to VM-loopback Prometheus, waits two scrape intervals, verifies fresh k6/API/DB-client/VM series, and screens and publishes the sanitized report and scope artifact before marking smoke verified. A failed, cancelled, or uncertain smoke is **not retryable under that ID**; the finalizer attempts reviewed teardown, and manual recovery may still be needed.

After success, review the Actions summary and sanitized report artifact, the **Load Tests → Load Test Correlation** dashboard, and Supabase Studio for the same UTC window. From an authorized operator machine, access private Grafana with your own SSH tunnel:

```bash
ssh -N -L 13001:127.0.0.1:3001 ubuntu@YOUR_VM_HOST
```

Open `http://127.0.0.1:13001/d/chalktalk-load-test-correlation/load-test-correlation?var-testid=<RUN_ID>` and select the run’s UTC range. The former laptop-hosted k6 web dashboard is **not exposed** by Actions. k6 client latency includes the runner’s network and is displayed in seconds; API/DB panels show server-side HTTP and client-observed query/pool time; VM panels show actual host load. App/VM series are time-aligned, not attributable only to test traffic. Supabase Studio is the separate database-server view.

## Separate ramp dispatch

Only after smoke success, a reviewed fixture inventory, matching deployed SHA/profile, fresh metrics, acceptable Studio baseline, and an explicit operator window, manually dispatch **another** workflow run with `mode=ramp` and the **same** run ID:

```bash
gh workflow run load-test.yml --ref main -f mode=ramp -f run_id=load-20261117-a1b2c3d4
```

The VM atomically claims ramp only if smoke was verified within 30 minutes with the same deployed SHA and normalized Environment profile. Changing the variables or deploying a new SHA between dispatches blocks ramp; use reviewed cleanup and a new run ID. Fixed stage targets 1→5→10→20 are capped by `LOAD_TEST_MAX_VUS`; one VU is the only writer, with 6–17 ramp attempts spaced at least 30 seconds apart. The smoke adds one vote attempt, so the default reviewed sequence is at most 18 attempts. No user input or ambient `K6_*` variable can raise the code-owned maxima, duration, operation set, or fixed production URL. Every selected read and all six mutation types need a successful checked response. Missing coverage **fails** the run; do not lengthen or intensify it to compensate.

**Stop/cancel** for 429, ambiguous write outcome, >2% unexpected errors, sustained 5xx, DB failures or rising pool waits, stale remote-write/scrapes, VM memory/disk pressure, Supabase memory/connection warnings, or dropped iterations/runner saturation. A failed or uncertain ramp is not retried under the same ID. A repeat dispatch cannot claim the VM-owned state.

## Reports, cleanup, and recovery

Actions uploads only screened HTML/JSON reports and a scope disclosure with the measured workload UTC start/end; manifest, passwords, database URL, and SSH material are never artifacts. The Actions summary also records the workload window and effective profile. Retain those, run ID, deployed SHA, dashboard screenshots, sanitized report, and Studio observations. A local or Actions report alone does not prove Grafana correlation.

The ramp finalizer inventories and attempts transactionally scoped fixture teardown even if k6 fails. A failed smoke also attempts teardown. Teardown removes only manifest-owned rows and reviewed semantic dependents, refuses foreign/ambiguous references, more than 64 indexing jobs or 64 catch-up rows, more than seven indexable posts, and active/retryable indexing jobs. It verifies zero residue and removes the manifest and per-run DB URL only after commit. A successful smoke intentionally leaves the isolated fixture for the separately approved ramp; if no ramp follows, clean it up manually. **An Actions job ending does not prove cleanup succeeded.** A lost runner or active semantic worker can leave a consumed state and fixture; do not reset or reuse them.

For manual recovery, SSH to the VM with the pinned host key and inspect `/srv/chalktalk/shared/load-test/<RUN_ID>.state.json` plus the owner-only manifest. From the matching deployed release, use `deployment/load-test/vm_fixture.sh inventory <RUN_ID> <SHA> <PROJECT_REF> <DB_HOST>`, review its dependency list, wait for semantic jobs to quiesce, then run `deployment/load-test/vm_fixture.sh teardown <RUN_ID> <SHA> <PROJECT_REF> <DB_HOST> <RUN_ID>`. Only after verified zero residue, call `python3 deployment/load-test/vm_state.py mark-cleaned --run-id <RUN_ID> --deployed-sha <SHA> --profile-file /srv/chalktalk/shared/load-test/<RUN_ID>.<ACTIONS_RUN_ID>.profile.json`. If the manifest is absent after an interrupted provision, **do not assume zero rows**: verify the namespace through privileged database review before marking state cleaned. Never force-delete or use broad cascade. Create a **new** run ID for any further attempt.

The approved [design](../../docs/design/2026-11-16-k6-production-load-testing.md) governs this procedure.
