# Bounded production k6 test — GitHub Actions

This is a **manually dispatched backend-only HTTP API test of selected core flows**, not an automatic CI load test and **not all app flows**. It covers login; course, feed, post-detail, notification, and unread-count reads; and isolated question, note, answer, follow-up, poll, and vote writes. It does **not** cover course creation, files, email, or live collaboration. Fixture setup/cleanup is a separate privileged VM/database operation, not API traffic. The production API still uses Supabase PostgreSQL; Supabase server metrics are **not** scraped. Watch Supabase Studio manually.

## Before dispatch

Merge and deploy the reviewed change. The separate **Smoke** and **Ramp** workflows are available only from current `main`, check that the VM deployed SHA equals their checkout, use the existing `production` Environment and pinned SSH host key, and serialize with deployment in `chalktalk-production-vm`. A dispatch before the matching release is deployed fails closed. Neither runs on an ordinary push, PR, or deploy; neither asks for a run ID.

Ramp has one required **manual workflow input**, `max_concurrent_users`, a whole-number limit from 2 through 20. GitHub Actions may pass a selection such as 15 as `15.0`; the runner accepts that equivalent value but rejects fractional or malformed inputs. Smoke has no inputs. The four Ramp stages are code-owned: 2, 5, 10, and the selected maximum (each capped by that maximum) for 1, 3, 3, and 3 minutes. One of the active users is the bounded writer. The old `LOAD_TEST_MAX_VUS`, `LOAD_TEST_STAGE_MINUTES`, and `LOAD_TEST_RAMP_WRITE_ATTEMPTS` production variables are no longer used by these workflows.

Existing `production` `DATABASE_URL` secret and `SUPABASE_STORAGE_ENDPOINT` variable must describe the **same Supabase project** and match the VM’s deployed `production.env` URL. The workflow checks exact project/host/TLS shape and compares the URLs privately before provisioning; it does not independently prove the project is the one you intend. Confirm that project in Supabase Studio. Existing SSH secrets (`SSH_PRIVATE_KEY`, `VM_HOST`, `VM_KNOWN_HOSTS`) are used; no new project-identity secret is needed.

Confirm healthy API/worker/collaboration/Node Exporter scrapes, VM memory/disk, dashboard access, and a healthy Studio baseline. Do **not** start with an active Supabase memory warning without an explicit headroom/stop decision. Schedule an operator window; a person must watch Grafana and Studio and cancel on a safety signal. The VM allows only one active or cleanup-uncertain fixture globally; resolve any earlier fixture through reviewed cleanup before starting another Smoke or Ramp.

The runner waits up to three minutes for two fresh `up=1` samples from each required application and VM scrape target **before** claiming or creating a fixture. A readiness failure creates no attempt state. An idle API need not have HTTP or DB-client latency histograms before the test; those series are required **after** the smoke traffic, together with fresh k6 and VM data, before smoke can be verified. A Ramp dispatch performs the same readiness and post-traffic telemetry checks independently.

## Smoke dispatch and review

From GitHub Actions, open **Smoke production load test → Run workflow** and select `main`. There are no inputs. Or run:

```bash
gh workflow run load-test-smoke.yml --ref main
```

After scrape readiness passes, the VM atomically creates a unique fixture ID from the trusted Actions run identity and consumes the smoke attempt **before** fixture provisioning or traffic. It creates 20 synthetic verified users, one isolated organization/course, and prerequisite question/poll, with fixture email preferences disabled. No public auth bypass is added. The runner receives the 0600 manifest transiently over pinned SSH. One VU logs in once, retains cookie/CSRF, reads the selected routes, and makes one protected vote. A successful checked response is required for every smoke operation. The runner sends k6 metrics through a private SSH tunnel to VM-loopback Prometheus, waits two scrape intervals, verifies fresh k6/API/DB-client/VM series, and screens and publishes the sanitized report and scope artifact before completing Smoke. The generated ID and source workflow run URL are in the Actions summary and sanitized scope artifact. A failed, cancelled, or uncertain smoke **after claim** is not retryable; the finalizer attempts reviewed teardown, and manual recovery may still be needed. Do not use GitHub's **Re-run jobs** action; attempts after the first are refused.

After success and verified self-cleanup, review the Actions summary and sanitized report artifact, the **Load Tests → Load Test Correlation** dashboard, and Supabase Studio for the same UTC window. From an authorized operator machine, access private Grafana with your own SSH tunnel:

```bash
ssh -N -L 13001:127.0.0.1:3001 ubuntu@YOUR_VM_HOST
```

Open `http://127.0.0.1:13001/d/chalktalk-load-test-correlation/load-test-correlation?var-testid=<GENERATED_ID_FROM_SUMMARY>` and select the run’s UTC range. The former laptop-hosted k6 web dashboard is **not exposed** by Actions. k6 client latency includes the runner’s network and is displayed in seconds; API/DB panels show server-side HTTP and client-observed query/pool time; VM panels show actual host load. App/VM series are time-aligned, not attributable only to test traffic. Supabase Studio is the separate database-server view.

## Independent ramp dispatch

Smoke is optional. Once the intended production deployment and Supabase/VM headroom are confirmed, manually dispatch **Ramp production load test** on `main` with the maximum total concurrent users (2–20):

```bash
gh workflow run load-test-ramp.yml --ref main -f max_concurrent_users=10
```

Ramp creates its own fresh, isolated fixture and automatic run ID; it does not discover or reuse a Smoke fixture. The VM lock refuses an active or cleanup-uncertain prior fixture, including one left by the legacy Smoke-to-Ramp workflow. After provisioning, the VM records a digest of the exact private manifest and the runner verifies its copied bytes before API traffic. VU 1 is a writer-only instructor session: at most 17 attempts, at least 30 seconds apart, cycling question, note, answer, follow-up, poll, and vote. Other VUs browse courses, posts, post detail, and notifications with bounded think time. Every selected operation requires at least one successful checked response. This is session-like concurrency, **not** a promised TPS. Both the ten-minute schedule and write ceiling are fixed in code. A failed run is not retried under the same ID; review cleanup and dispatch a new run.

**Stop/cancel** for 429, ambiguous write outcome, >2% unexpected errors, sustained 5xx, DB failures or rising pool waits, stale remote-write/scrapes, VM memory/disk pressure, Supabase memory/connection warnings, or dropped iterations/runner saturation. A failed or uncertain ramp is not retried under the same ID. A repeat dispatch cannot claim the VM-owned state.

## Reports, cleanup, and recovery

Actions uploads only screened HTML/JSON reports and a scope disclosure with the generated fixture ID, source workflow URL, and measured workload UTC start/end; manifest, passwords, database URL, and SSH material are never artifacts. The Actions summary also records the workload window and effective profile. Retain those, deployed SHA, dashboard screenshots, sanitized report, and Studio observations. A local or Actions report alone does not prove Grafana correlation.

Both Smoke and Ramp inventory and attempt transactionally scoped fixture teardown on success or failure. Teardown removes only manifest-owned rows and reviewed semantic dependents, refuses foreign/ambiguous references, more than 64 indexing jobs or 64 catch-up rows, more than seven indexable posts, and active/retryable indexing jobs. It verifies zero residue and removes the manifest and per-run DB URL only after commit. Only after zero residue and removal of private fixture files does VM state become `cleaned`. Recognized pre-transaction connection-acquisition exhaustion permits at most two further inventory/teardown attempts within two minutes; a changed retry inventory, ambiguous outcome, or foreign reference fails closed for manual review. **An Actions job ending does not prove cleanup succeeded.** A lost runner or active semantic worker can leave a consumed state and fixture; do not reset or reuse them.

For manual recovery, SSH to the VM with the pinned host key and inspect `/srv/chalktalk/shared/load-test/<GENERATED_ID>.state.json` plus the owner-only manifest. The state includes the source workflow URL for that Smoke or Ramp attempt. From the matching deployed release, use `deployment/load-test/vm_fixture.sh inventory <GENERATED_ID> <SHA> <PROJECT_REF> <DB_HOST>`, review its dependency list, wait for semantic jobs to quiesce, then run `deployment/load-test/vm_fixture.sh teardown <GENERATED_ID> <SHA> <PROJECT_REF> <DB_HOST> <GENERATED_ID>`. Only after verified zero residue, call `python3 deployment/load-test/vm_state.py mark-cleaned --run-id <GENERATED_ID> --deployed-sha <SHA> --profile-file /srv/chalktalk/shared/load-test/attempt-<ACTIONS_RUN_ID>.profile.json` using the profile file from the attempt being recovered. If the manifest is absent after an interrupted provision, **do not assume zero rows**: verify the namespace through privileged database review before marking state cleaned. Never force-delete or use broad cascade. A fresh Smoke or Ramp dispatch generates a new ID after cleanup.

The approved [independent Ramp design](../../docs/design/2026-11-17-independent-ramp-user-flow.md) governs this procedure.
