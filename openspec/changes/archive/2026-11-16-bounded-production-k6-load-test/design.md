## Context

This change implements the approved [production k6 design](2026-11-16-k6-production-load-testing.md) on top of merged VM metrics. Public API contracts remain unchanged. Production DB access is high risk because local port 5432 may be an SSH tunnel to production.

## Decisions

- Keep the runner external and manually invoked; no CI or deploy hook creates load.
- Use a separate privileged Node/TypeScript fixture CLI that accepts an explicit connection option rather than `DATABASE_URL`. Validate project host/ref and target identity before a transaction. No fixture tests use local IPv4 port 5432.
- Treat a manifest of generated IDs as authoritative ownership. Enumerate current FK dependents before teardown, reject unknown/foreign rows, delete in reverse dependency order in a single transaction, and check residue before commit.
- Use fixed k6 operation tags and disable dynamic URL tags. Keep a single writer and an 18-mutation cap per k6 invocation under the total VU cap; separate smoke from ramp. The runner-copy ledger guards accidental local repeats, not copies of the VM manifest. Never recopy or rerun an attempted fixture; provision a fresh run ID.
- Refuse teardown when reviewed semantic dependents exceed 64 owned indexing jobs or 64 owned catch-up rows, or the course has more than 7 distinct indexable question/note posts.
- Bind remote-write receiver to `127.0.0.1:9090` on the VM. The dashboard has a run-ID selector only on k6 series; app/VM panels share the UTC window, not the run label.
- Require observed fresh series from all three sources before any actual production ramp. The implementation task does not perform that ramp.

## Risks / Mitigations

- Fixture deletion can affect real data: target proof, manifest ownership, explicit inventory, FK guard, transaction, and zero-residue check.
- SSH remote-write is a private ingestion surface: loopback bind only and fixed k6 cardinality.
- Default k6 labels can expose IDs: disable URL system tag and tag only static route templates.
- Real traffic overlaps dashboard series: mark app/VM panels as time-aligned rather than isolated.
