# Design

The privileged `workflow_run` first passes an unprivileged repository/branch/event/conclusion/current-SHA guard. A production-environment job repeats it before SSH. GitHub workflow concurrency matches VM bootstrap; a VM `flock` protects out-of-band invocations. Each release is a detached exact-SHA checkout under `/srv/chalktalk/releases`, with shared production env. Compose validates and builds all images before starting. The migration dependency gates services. Failure leaves the old checkout and migration state available for manual recovery, without a database rollback. Successful internal and external smoke checks precede a durable success marker. A repeated successful SHA skips provider smoke.

See [architecture decision](../../../../documentation/design/2026-11-10-automatic-vm-deployment.md) for rationale.
