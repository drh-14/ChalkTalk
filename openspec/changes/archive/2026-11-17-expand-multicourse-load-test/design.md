## Context

See the approved detailed design in `docs/design/2026-11-17-multicourse-journey-load-test.md`. The existing independent Ramp has one course, one writer, and a 20-user ceiling; cleanup relies on an explicit table allowlist.

## Goals / Non-Goals

**Goals:** Representative bounded ordinary course activity, provable three-course fixture ownership, run-scoped single-unit HTML charts, safe post-cleanup email delivery.

**Non-Goals:** An exact TPS target, all product features, collaboration load, a new public API, a production dispatch during this change.

## Decisions

- Preserve the existing VM-owned singleton and separate Smoke/Ramp workflows. Ramp gets a mode-specific three-course manifest; Smoke retains its old fixture and journey.
- Generate a fixed write schedule in k6 setup: globally unique absolute slots six seconds apart and a one-second late-start deadline. This yields at least five seconds between actual intentional write starts without a shared coordination service. Skip expired slots and mark required coverage incomplete. Incidental DB writes from read endpoints are not subject to the floor.
- Assign each active VU to one interleaved course cohort and role. Deterministic initial journeys establish required operation coverage; seeded choices and think pauses create later session-like variation.
- Expand explicit ownership discovery and reverse-dependency deletion for Thread and resource rows. Inventory before and after, apply family-specific caps, and refuse foreign/unknown references; never trust cascades as proof.
- Query only allowlisted run-ID-scoped Prometheus k6 series through the existing private tunnel at a bounded resolution/window. Render static local SVG panels with one declared unit each; retain the original screened k6 export only as an artifact fallback.
- Create a cleanup receipt only after verified zero residue and cleaned VM state. Send only four screened named files via the existing Resend production key after that receipt; record delivery separately from test/cleanup status and never retry ambiguous sends.

## Risks / Trade-offs

- **Connection pressure** → operator reviews Supabase headroom before dispatch; no production run in implementation, bounded retries only on recognized pre-transaction connection exhaustion.
- **Incomplete coverage due to slow/late VUs** → fail incomplete without catch-up or extra traffic.
- **Unexpected Thread dependent rows** → fail closed with retained manifest for reviewed recovery.
- **Missing Prometheus series or email rejection** → keep test and cleanup outcomes separate; preserve safe artifact fallback and disclose report/delivery failure.

## Migration Plan

Merge/deploy on trusted main after one-commit draft PR and final checks. Existing completed state remains valid. Operators should run Smoke first for readiness, then separately approve a low-ceiling Ramp after checking DB connection and memory headroom. Roll back the workflow/release if new Ramp is unsafe; clean any active fixture through reviewed VM recovery before retrying.
