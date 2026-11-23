# Modular local deployment verification

Implementation verification on 2026-11-22 used disposable, explicitly named
projects and synthetic credentials. No real email was sent, no real external
service was used, and no operator/default-project services were modified.

## Tests-first evidence

Executable interfaces failed before implementation: launcher absent (36 failures
of 47 initial tests), local environment selection (18 failures), HTTPS adapters
(13 failures), read-only migration inventory, semantic migration tracking/adoption
and incompatible-index rejection, literal/URL/sender parity, bounded stalled SES
credential resolution, expired credential sources, and unsafe control-byte/origin
input. Each affected test passed after its implementation/fix. The remote database
error-prefix regression also failed before replacing message-prefix trust with a
private error type. Tests assert behavior, normalized real Compose output, database
catalogs, signed object operations and transport calls rather than source strings.

## Isolated runtime coverage

```sh
node --test deployment/local/tests/start.runtime.test.mjs
```

`RUNTIME_CASE_FILTER` selects a positive case and `RUNTIME_FAILURE_ONLY=1`
selects the negative phase-boundary cases. The complete positive run passed 16 cases plus its parent (zero skips):
four database/store topologies crossed with Resend, SendGrid, SES explicit and
SES default-chain. It checked real service inventory, database identity, empty
application data, signed object put/get, retained volumes and provider changes.
The default-stack case additionally passed executable HTTPS/WebSocket gateway,
CA persistence, S3 persistence and observability/privacy/outage-recovery checks.
An actual SDK signature test in the running sending container observed credential
rotation without changing frozen payload bytes; its separate regression also
checked the regional HTTPS endpoint and ignored ambient AWS endpoint overrides.

The negative run passed six cases plus its parent (zero skips): external ordinary
migrations pending without acknowledgment, missing/denied external bucket,
unavailable explicitly selected SES source, migration permission denial and
missing external semantic prerequisite. Catalogs were unchanged and no
application traffic/worker service started. Container creation after static
acceptance is intentional; static failures make zero Docker calls.

## Repository checks

```sh
node --test deployment/local/tests/start.test.mjs \
  deployment/local/tests/ci-start.test.mjs \
  deployment/local/tests/compose-logging.test.mjs
# 138 passed, zero skips
npx vitest run --project api apps/api/compose.test.ts apps/api/dockerignore.test.ts
# 14 passed, zero skips; real Docker/Compose consumer checks
npm run format:check
npm run lint
npm run typecheck
npm run build
# all passed; existing web bundle size warning only
```

The application suite runs in the project's Node 22 application image with
read-only source and separate dependency volumes, connected only to owned
PostgreSQL 17/pgvector and S3 fixtures. Both TEST_DATABASE_URL and
TEST_VECTOR_DATABASE_URL select that database; TEST_S3_ENDPOINT and its synthetic
credentials select the fixture store. The two Docker-specific files above run
separately on the host because they require a writable build-context fixture and
Docker CLI. No test files are omitted from the combined verification.

```sh
npm test -- --exclude apps/api/compose.test.ts \
  --exclude apps/api/dockerignore.test.ts --maxWorkers=1
```

Final serial application suite: 148 files passed, one opt-in file skipped;
1,955 tests passed, 10 opt-in tests skipped, zero failures (346 seconds).
A previous two-worker run passed 1,953 tests but had two unchanged App history/
loading tests fail; both passed in the complete serial rerun without source edits.
Legacy
Mailpit capture cases require their explicit SMTP fixture and remain opt-in;
local deployment itself deliberately has no Mailpit/SMTP service. New real
S3-backed image-freeze/deletion-cancellation cases cover all three HTTPS
providers without SMTP or real provider calls. Existing K6 fixture tests are
also opt-in and retain their dedicated CI stage. Host Node 26 exhibited
intermittent unrelated HTTP/socket races, so it is not claimed as a full-suite
pass; the declared Node 22 application runtime is the verification baseline.

Strict OpenSpec validation and main-spec validation are required before archive.
No frontend source or production deployment artifacts changed; existing CI browser
flows remain enabled and use only the explicitly injected synthetic mail transport.

## Delivery (outside the implementation archive)

- [ ] Full no-mistakes gate without skipped phases or unapproved exceptions.
- [ ] One scoped final commit, preserving planning and gate-fix histories before
      any consolidation and honoring gate custody/sync instructions.
- [ ] Separate draft PR, immediate T3 linkage, exact-head check status reported.

These boxes are delivery evidence, not a claim that publication or CI has passed.
Do not merge, mark ready, or start a separate PR watcher; the parent owns pending
check follow-up.

## First no-mistakes run (not a pass)

Run `01M82EKTWHY9JXQ47C0SQYYSHV` completed source review after fixing
deselected bundled-service shutdown, SendGrid accepted-response cleanup, final
startup failure gating/health waiting, and explicit Resend idempotency wording.
Its live Test agent reported a go verdict for all four topologies and runtime
negatives, but native completion was rejected because an owned
`SkyComputerUseClient` child remained active. The run failed before Document,
Lint, Push, PR or CI; there was no bypass or publication. Custody was recovered
using exactly `no-mistakes axi sync --recover`. Complete fix history is preserved
in `archive/modular-local-deployment-gate-fixes-20261122`.

Post-recovery checks: 141 launcher/CI/logging tests and 25 mail adapter/refresh/CI
transport tests passed. Lint found an empty catch in the gate fix; an explanatory
comment resolves it without changing behavior. A new full gate on the consolidated
head is required; prior success claims do not cover that head automatically.

## Final-head CI mount-order regression

The final single-commit head 95d1dfd6 exposed a deterministic assertion defect
in the runtime persistence test: Docker returned identical mount objects in a
different array order after recreation. Replaying the captured inspect output
reproduced the exact assertion failure. Destination-keyed comparison proved
all fields unchanged. The runtime comparator now normalizes only mount ordering,
retaining every field; regression cases require changed identity, source,
destination, type, driver, mode, writable flag, propagation and mount count to
remain distinguishable. The replay test failed before the normalization fix.
CI runs this focused regression before its full real startup matrix. No product
startup behavior or test expectation about retained data was relaxed.

Regression verification: 10 focused replay/negative cases passed; the combined
launcher/CI/logging/mount suite passed 151 tests, and real Compose/build-context
consumer checks passed 14. The original live true/true/Resend restart scenario
and six runtime rejection cases passed (8 including parent, zero skips). Format,
lint, typecheck and build passed. A fresh gate and final-head CI remain required.

## Database coverage and approved CI scope cleanup

The database validation now uses real, disposable PostgreSQL/pgvector 17 and
SeaweedFS 4.48 fixtures. The entire database directory ran as 14 files and 42
tests with zero failures/skips, including the four opt-in load-fixture tests.
The CI split runs 13 database files/38 tests through the reporter-backed
zero-skip assertion, plus four load-fixture tests on their separate protected
PostgreSQL instance. The load fixture retains its loopback port/database guards;
no operator or production database is used.

A job-wide S3 environment unintentionally activated unrelated upload/OCR
integration suites. The user approved restricting those variables to the S3
fixture startup and explicit database validation steps, rather than retaining
an unreproduced PDF-upload behavior change or unrelated frontend test edit.
Both unrelated edits were removed exactly; complete prior history remains
preserved. A parsed YAML environment-inheritance regression executed RED with
the job-wide environment and GREEN after step scoping. It also executes shell
environment resolution, rather than grepping workflow source. No frontend
source/behavior change remains, and no new dependency was introduced.

These local checks do not constitute final-head CI. Full gate validation and
single-commit final-head native checks are required after this cleanup.
