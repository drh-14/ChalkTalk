# Bounded production k6 test — GitHub Actions

This is a **manually dispatched backend-only HTTP API test of selected core flows**, not an automatic CI load test and **not all app flows**. It covers login; course, feed, post-detail, notification, and unread-count reads; and isolated question, note, answer, follow-up, poll, and vote writes. It does **not** cover course creation, files, email, or live collaboration. Fixture setup/cleanup is a separate privileged VM/database operation, not API traffic. The production API still uses Supabase PostgreSQL; Supabase server metrics are **not** scraped. Watch Supabase Studio manually.

## Before dispatch

Merge and deploy the reviewed change. The separate **Smoke** and **Ramp** workflows are available only from current `main`, check that the VM deployed SHA equals their checkout, use the existing `production` Environment and pinned SSH host key, and serialize with deployment in `chalktalk-production-vm`. A dispatch before the matching release is deployed fails closed. Neither runs on an ordinary push, PR, or deploy; neither asks for a run ID.

Set these **non-secret variables in GitHub’s `production` Environment** before dispatch; missing/invalid values fail before VM fixture access:

| Variable                        | Allowed value                                  | Initial value |
| ------------------------------- | ---------------------------------------------- | ------------- |
| `LOAD_TEST_MAX_VUS`             | Integer 1–20; caps fixed targets 1→5→10→20     | `20`          |
| `LOAD_TEST_STAGE_MINUTES`       | Exactly four positive integer minutes, sum ≤10 | `1,3,3,3`     |
| `LOAD_TEST_RAMP_WRITE_ATTEMPTS` | Integer 6–17                                   | `17`          |

Existing `production` `DATABASE_URL` secret and `SUPABASE_STORAGE_ENDPOINT` variable must describe the **same Supabase project** and match the VM’s deployed `production.env` URL. The workflow checks exact project/host/TLS shape and compares the URLs privately before provisioning; it does not independently prove the project is the one you intend. Confirm that project in Supabase Studio. Existing SSH secrets (`SSH_PRIVATE_KEY`, `VM_HOST`, `VM_KNOWN_HOSTS`) are used; no new project-identity secret is needed.

Confirm healthy API/worker/collaboration/Node Exporter scrapes, VM memory/disk, dashboard access, and a healthy Studio baseline. Do **not** start with an active Supabase memory warning without an explicit headroom/stop decision. Schedule an operator window; a person must watch Grafana and Studio and cancel on a safety signal. The VM allows only one active or cleanup-uncertain fixture globally; resolve any earlier fixture through reviewed cleanup before starting another Smoke.

The runner waits up to three minutes for two fresh `up=1` samples from each required application and VM scrape target **before** claiming or creating a fixture. A readiness failure creates no attempt state. An idle API need not have HTTP or DB-client latency histograms before the test; those series are required **after** the smoke traffic, together with fresh k6 and VM data, before smoke can be verified. Do not dispatch Ramp if that post-smoke gate fails.

## Smoke dispatch and review

From GitHub Actions, open **Smoke production load test → Run workflow** and select `main`. There are no inputs. Or run:

```bash
gh workflow run load-test-smoke.yml --ref main
```

After scrape readiness passes, the VM atomically creates a unique fixture ID from the trusted Actions run identity and consumes the smoke attempt **before** fixture provisioning or traffic. It creates 20 synthetic verified users, one isolated organization/course, and prerequisite question/poll, with fixture email preferences disabled. No public auth bypass is added. The runner receives the 0600 manifest transiently over pinned SSH. One VU logs in once, retains cookie/CSRF, reads the selected routes, and makes one protected vote. A successful checked response is required for every smoke operation. The runner sends k6 metrics through a private SSH tunnel to VM-loopback Prometheus, waits two scrape intervals, verifies fresh k6/API/DB-client/VM series, and screens and publishes the sanitized report and scope artifact before marking smoke verified. The generated ID and source Smoke run URL are in the Actions summary and sanitized scope artifact. A failed, cancelled, or uncertain smoke **after claim** is not retryable; the finalizer attempts reviewed teardown, and manual recovery may still be needed. Do not use GitHub's **Re-run jobs** action; attempts after the first are refused.

After success, review the Actions summary and sanitized report artifact, the **Load Tests → Load Test Correlation** dashboard, and Supabase Studio for the same UTC window. From an authorized operator machine, access private Grafana with your own SSH tunnel:

```bash
ssh -N -L 13001:127.0.0.1:3001 ubuntu@YOUR_VM_HOST
```

Open `http://127.0.0.1:13001/d/chalktalk-load-test-correlation/load-test-correlation?var-testid=<GENERATED_ID_FROM_SUMMARY>` and select the run’s UTC range. The former laptop-hosted k6 web dashboard is **not exposed** by Actions. k6 client latency includes the runner’s network and is displayed in seconds; API/DB panels show server-side HTTP and client-observed query/pool time; VM panels show actual host load. App/VM series are time-aligned, not attributable only to test traffic. Supabase Studio is the separate database-server view.

## Separate ramp dispatch

Only after Smoke success, a reviewed fixture inventory, matching deployed SHA/profile, fresh metrics, acceptable Studio baseline, and an explicit operator window, manually dispatch **Ramp production load test** on `main`. It has no inputs and does not start automatically:

```bash
gh workflow run load-test-ramp.yml --ref main
```

Under a VM lock, Ramp discovers and atomically claims **exactly one** verified Smoke fixture no more than 30 minutes old, with the same deployed SHA, normalized Environment profile, Supabase target, manifest, and source-run provenance. After successful Smoke inventory and telemetry checks, the VM records the SHA-256 of the exact owner-only manifest bytes; Ramp compares those bytes to the recorded digest before changing claim state. No candidate, multiple/uncertain fixtures, changed variables, or a deployment between dispatches blocks Ramp; use reviewed cleanup and a new Smoke dispatch. Fixed stage targets 1→5→10→20 are capped by `LOAD_TEST_MAX_VUS`; one VU is the only writer, with 6–17 ramp attempts spaced at least 30 seconds apart. The smoke adds one vote attempt, so the default reviewed sequence is at most 18 attempts. No input or ambient `K6_*` variable can raise the code-owned maxima, duration, operation set, or fixed production URL. Every selected read and all six mutation types need a successful checked response. Missing coverage **fails** the run; do not lengthen or intensify it to compensate.

**Stop/cancel** for 429, ambiguous write outcome, >2% unexpected errors, sustained 5xx, DB failures or rising pool waits, stale remote-write/scrapes, VM memory/disk pressure, Supabase memory/connection warnings, or dropped iterations/runner saturation. A failed or uncertain ramp is not retried under the same ID. A repeat dispatch cannot claim the VM-owned state.

## Reports, cleanup, and recovery

Actions uploads only screened HTML/JSON reports and a scope disclosure with the generated fixture ID, source Smoke URL, and measured workload UTC start/end; manifest, passwords, database URL, and SSH material are never artifacts. The Actions summary also records the workload window and effective profile. Retain those, deployed SHA, dashboard screenshots, sanitized report, and Studio observations. A local or Actions report alone does not prove Grafana correlation.

The ramp finalizer inventories and attempts transactionally scoped fixture teardown even if k6 fails. A failed smoke also attempts teardown. Teardown removes only manifest-owned rows and reviewed semantic dependents, refuses foreign/ambiguous references, more than 64 indexing jobs or 64 catch-up rows, more than seven indexable posts, and active/retryable indexing jobs. It verifies zero residue and removes the manifest and per-run DB URL only after commit. A successful smoke intentionally leaves the isolated fixture for the separately approved ramp; if no ramp follows, clean it up manually. **An Actions job ending does not prove cleanup succeeded.** A lost runner or active semantic worker can leave a consumed state and fixture; do not reset or reuse them.

For manual recovery, SSH to the VM with the pinned host key and inspect `/srv/chalktalk/shared/load-test/<GENERATED_ID>.state.json` plus the owner-only manifest. The state includes the source Smoke workflow URL. From the matching deployed release, use `deployment/load-test/vm_fixture.sh inventory <GENERATED_ID> <SHA> <PROJECT_REF> <DB_HOST>`, review its dependency list, wait for semantic jobs to quiesce, then run `deployment/load-test/vm_fixture.sh teardown <GENERATED_ID> <SHA> <PROJECT_REF> <DB_HOST> <GENERATED_ID>`. Only after verified zero residue, call `python3 deployment/load-test/vm_state.py mark-cleaned --run-id <GENERATED_ID> --deployed-sha <SHA> --profile-file /srv/chalktalk/shared/load-test/attempt-<ACTIONS_RUN_ID>.profile.json` using the profile file from the attempt being recovered. If the manifest is absent after an interrupted provision, **do not assume zero rows**: verify the namespace through privileged database review before marking state cleaned. Never force-delete or use broad cascade. A fresh Smoke dispatch generates the next ID after cleanup.

The approved [design](../../docs/design/2026-11-16-k6-production-load-testing.md) governs this procedure.
