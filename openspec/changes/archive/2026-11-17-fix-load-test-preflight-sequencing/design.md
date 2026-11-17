## Context

The production runner currently claims and provisions before calling `preflight.mjs app`, which checks all application histograms as well as scrape health. API health and metrics endpoints are deliberately excluded from HTTP latency instrumentation. Prometheus scrapes once per minute, and a deployment can restart it shortly before a manual load dispatch.

## Goals / Non-Goals

**Goals:** Preserve two-sample scrape freshness and the complete post-smoke HTTP/DB/k6/VM gate, while refusing unready infrastructure before any VM attempt claim.

**Non-Goals:** Generate synthetic API traffic to warm metrics, alter the k6 workload, relax post-smoke observability, or change production scrape configuration.

## Decisions

- Split the verifier into pre-traffic scrape readiness and post-traffic full telemetry modes, reusing the existing Prometheus query logic and target definitions. This avoids an unrelated metrics format change.
- Run a bounded, read-only readiness poll before the VM attempt claim and before smoke fixture provision. Polls retain the two-sample, `up=1` rule; timeout identifies the last failing target. Unlike fixed sleeps, the poll proceeds as soon as telemetry is ready and fails closed for unhealthy targets.
- Keep the post-smoke `all` check after k6 and two scrape intervals, so HTTP, DB-client, VM, and k6 data still gate smoke verification. The ramp continues to require pre-traffic scrape readiness; it does not claim a prior successful smoke until healthy.
- Split the manual entry point into two no-input workflows sharing the existing production Environment, VM concurrency group, pinned checkout/SSH, and runner. Workflow-specific fixed mode replaces a user-selectable mode input. Refuse `GITHUB_RUN_ATTEMPT>1` before SSH or fixture access.
- Derive Smoke's valid opaque ID from the trusted GitHub Actions run identity, not new randomness on each execution. The VM claim stores the source run ID/URL, project identity, and fingerprint alongside the existing state. Ramp's runner starts without an ID, obtains the selected ID only from the VM under the same lock that claims it, then reuses existing manifest, inventory, workload, report, and cleanup paths.
- Under the VM state lock, reject a new Smoke if any owner-only state is not correctly `cleaned`. Treat legacy cleaned records as resolved only after verifying their shape and absence of manifest/DB-URL files. After successful Smoke inventory and observability checks, record the exact owner-only manifest bytes' SHA-256 in verified VM state. Ramp enumerates state files and requires exactly one recent `smoke-verified` candidate with matching SHA/profile/project/DB target/provenance and manifest digest before mutating claim state. Never infer from GitHub's latest run or artifact.

## Risks / Trade-offs

- A slow but healthy restart can delay the job → bound the wait below the workflow timeout and show progress and target diagnostics.
- A transient target failure can become healthy during the wait → require two fresh `up=1` samples rather than one instantaneous response.
- A target can fail after readiness and before k6 → post-smoke checks remain authoritative; such a run fails and uses reviewed cleanup.
- State files can be incomplete or corrupt after a lost runner → fail closed on malformed records and refuse any new fixture until reviewed recovery.
- A no-input Ramp can otherwise pick the wrong fixture → VM-side singleton and exact identity/age/manifest checks are mandatory before its atomic claim.
