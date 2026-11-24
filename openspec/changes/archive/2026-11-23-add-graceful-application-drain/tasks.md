## 1. Review and coordination gates (before implementation)

- [x] 1.1 Record user approval of private host-staged boot-bound request file before SIGTERM, read once after cutoff with exact boot/release/image/nonce validation, no watcher/admin endpoint and no writer relabel restart. Planning is ready for implementation handoff; no redundant user approval is needed.
- [x] 1.2 Security 90927 coordination has been requested; parent will assign the shared integration slot explicitly after its response. Coordinate VM cdeee230 and paused Supabase 70d3; explicitly assign minimal production Compose mount/immutable-identity/grace edits and host path/UID/mode provisioning; record acknowledgment before any overlapping edits. Do not assume security implements app adapters. Do not edit paused handoff guide or other owners' namespaces.
- [x] 1.3 Verify latest origin/main and clean exclusive owned branch before implementation; preserve other work. Confirm Node/Hocuspocus existing hooks can freeze admission and serialize final stores. Escalate concrete hook limitations rather than silently replacing the approved design.
- [x] 1.4 Agree producer/consumer receipt/request fixtures with Supabase owner; keep replacement blocked until dependent verifier and external fence coverage exist. Record immutable release/image source and boot/container inventory mapping.

## 2. Lifecycle and evidence vertical slice (red then green)

- [x] 2.1 Add specification-derived runtime/process tests for STARTING signal races, repeated signals/one absolute deadline, fatal errors, cutoff before auth/claims, readiness and closure ordering. Run and record expected red before implementing.
- [x] 2.2 Implement new lifecycle types/runtime and minimal environment configuration; install handlers before async entrypoint startup, register partial-startup resources, distinguish stop-admission and force-cancel; prevent late RUNNING/listener/claim transitions. Re-run to green.
- [x] 2.3 Add real temporary-filesystem/process evidence tests first: boot descriptor, exact request binding, ordinary no-operation shutdown, strict malformed/symlink/size/identity validation, no PII, fs write/fsync/rename/dir-sync failures and deadline/hung filesystem. Record expected red.
- [x] 2.4 Implement atomic flushed boot/receipt publication using built-in fs only; successful closure+write exit 0, failure 1, timeout 2; immutable boot-specific files and no stale proof. Verify green and actual child exit results, including visible success receipt followed by nonzero exit.

## 3. HTTP and thread-live vertical slice (red then green)

- [x] 3.1 Add actual local HTTP/keep-alive/pipelined/WS tests for drain 503/Retry-After/close/no-store/CORS, probe schemas, pre-auth tracking and late authorization registration denial. Include real disconnected upload/response lifetime versus service settlement; record red.
- [x] 3.2 Integrate API entrypoint, async route completion ownership and admission before body/auth side effects. Audit required stream/S3/transaction/compensation/temp cleanup adapters only within scoped services. Preserve request success/auth/validation/header contracts; run green.
- [x] 3.3 Add delayed thread-live auth/message/notification/LISTEN/reconnect and close-callback tests before adapting threads/live.ts. Verify no late upgrade or reconnect and no pool close while callbacks remain; run green.
- [x] 3.4 Use isolated disposable PG/S3 to test delayed uploads, rollback/compensation, storage failure, ambiguous commit and dependency-close failures through public seams. No production data or live email.

## 4. Collaboration vertical slice (red then green)

- [x] 4.1 Add real WS/Yjs and isolated PG tests: pre-cutoff authorized edit settles, post-cutoff/buffered frame excluded, in-flight admission rollback, pending/older store ordering, connected/disconnected final documents, store failure propagation, no false session-ended or final_snapshot_confirmed mutation. Record red.
- [x] 4.2 Integrate collaboration main/server/transport with lifecycle; remove five-second independent clean-shutdown assumptions and finally-exit(0). Freeze admission, await handlers, persist exact frozen final states before destroy, settle disconnect/abort/store/LISTEN callbacks, preserve user-ending logic.
- [x] 4.3 Verify green including save failure then confirmed exact-version recovery, unrecovered error failure, destroy/close errors, startup signal, deadline, fresh-server reload and fresh-ticket reconnect. Assert persisted content rather than only promise completion.

## 5. Worker/digest/extraction vertical slice (red then green)

- [x] 5.1 Add blocked-claim/scheduler/backfill tests first across all lanes, including general jobs and digest fencing/zero-row updates, durable known retry versus unknown commit/provider acceptance. Fake email only; record red.
- [x] 5.2 Adapt jobs main/runner/worker, digest runner/service and semantic backfill ownership so poll stop is distinct from cancellation, attempt/transaction settlement is exposed and uncertainty cannot be swallowed. Keep established retry policy/fences; run green.
- [x] 5.3 Add real extraction child and heartbeat-query lifecycle tests before adapter changes: no SIGTERM cancellation before deadline, heartbeat alive while work settles, late heartbeat cannot renew released work, lease loss fails, searchable-PDF publication cleanup and temporary directories remain owned. Record red.
- [x] 5.4 Adapt extraction tools/download/store/publication only where necessary; await child/worker-thread and heartbeat queries before shared resources. Verify green; test 120s-default contract with shortened test deadline, forced cleanup exit 2 and no unconditional lease reset/fake-clean requeue.

## 6. Documentation and coordinated isolated integration

- [x] 6.1 Update OpenAPI and API lifecycle reference/probe/503 common semantics, collaboration WebSocket/session reconnect/durability and digest references; clarify database fence semantics without migrations. Add contract tests from these references first, preserving documented authorization, headers, errors, lifecycle and persistence rules.
- [x] 6.2 Only the explicitly assigned integration owner edits Compose mount/immutable identity/stop_grace_period >=150s and related minimal identity plumbing. Security owner provisions host paths/permissions/holds within its scope. Run isolated Compose config and Linux mount durability/nonroot access/SIGTERM/grace tests; do not run production deployment commands.
- [x] 6.3 Supply positive and negative evidence fixtures to dependent Supabase verifier: every role and observed exit0; missing role/file/exit, stale boot/operation/nonce/image/release, duplicate, malformed partial, wrong container, restart, OOM/KILL, nonzero, write failure and unfenced external writers. Require dependent consumer checks before unblocking replacement; do not implement its namespace here.
- [x] 6.4 Add real-browser mocked-API/transport scenarios for transient collaboration restart preserving local text and new tickets, thread-live reconnect/subscriptions and recoverable 503. Capture and inspect one screenshot per visible scenario; attach to eventual draft PR. If browser execution is unavailable, ask user before publication. Escalate meaningful frontend behavior changes before expanding scope.

## 7. Final implementation verification and delivery (authorized after planning)

- [x] 7.1 Run focused lifecycle/process, actual HTTP/WS, isolated PG/S3 fault/claim/lease/digest/extraction suites and existing affected regression suites; record coverage matrix and remaining gaps, no real mail.
- [x] 7.2 Run format checks, lint, typecheck, build, strict OpenSpec validation and no-mistakes gate; address findings and verify exact final head. Any unavailable check/gate is an explicit blocker/exception, not a pass.
- [ ] 7.3 After implementation authorization and review, archive completed OpenSpec change following repository workflow, commit only scoped work, squash gate fixes to one commit and publish draft PR with screenshots. Verify one commit, linked PR and final-head CI; keep draft until user requests ready. This historical planning prohibition was superseded by the explicit implementation/delivery authorization; do not publish before required verification.
- [x] 7.4 Handoff lifecycle capability/version and verified producer contract to security/VM/Supabase owners. Keep Supabase replacement paused until all writer instances support it, shared integration and consumer negative checks pass, inventory/holds/external fences are satisfied. Do not perform a live replacement.

## Approved reconnect correction — 2026-11-23

- [x] 8.1 Preserve existing Reconnecting UI/local document for transient fresh-ticket 503/network failures; add observable retry/classification/disposal tests first. Do not reuse consumed tickets or soften permanent auth/authorization/session-ended errors.
- [x] 8.2 Implement the narrow approved correction without styling changes, then verify actual mocked-API browser reconnect and capture/inspect screenshots.

## Coordination acknowledgment — 2026-11-23

The parent assigned exclusive minimal production Compose and lifecycle-specific host setup ownership after security90927 confirmed it was not editing Compose. Security retains bootstrap.yml/deploy.sh; those callsites remain untouched. Supabase70d3 acknowledged the wire contract compatible, NOT live integration or consumer verification. Its coordinator must stage each boot's atomic request before SIGTERM, inventory every replica independently, collect before removal, and recheck under its locks. Operation UUID is distinct from backup-set identity. Exact release and inspected role image IDs must be supplied before container creation. No automatic marker clearing, migration, smoke, or activation is assumed. The fixture set now includes additional zero-exit/no-receipt, invalid schema/count/timing and changed-inventory negatives. Consumer tests and external fencing remain required before replacement; they are not claimed as this producer's verification.

### Actual isolated producer/consumer wire acceptance

The VM owner reported 4 compatible tests covering original25mutations; the Supabase owner reported54consumer tests covering original25+5additional mutations. Those reports are not live cutover proof. In the producer worktree, six Linux acceptance tests passed, including actual lifecycle modules in non-root disposable containers for API/API/collaboration/worker. Each boot received a private staged0600request, SIGTERM, independently inspected image/restart/container identity and observed exit0; receipts were collected before removal and remained durable afterward. Feeding those four actual receipts to the Supabase consumer passed, and applying all30negative mutations rejected. Its result remained `externalFenceVerified:false,captureAuthorized:false`.

That seam check identified fractional elapsedMs incompatible with the consumer's integer wire contract. A serialization regression was first red, then green with floored whole milliseconds; full-precision monotonic deadline enforcement remains unchanged. The test-only Supertest client now uses the actual fixture address family after a red regression and controlled macOS reproduction showed IPv6wildcard could share a port with an IPv4listener, making Supertest reach another local service. No production bindings/host settings changed.

Historical releases/images lacking v1 producer, mounts or configured immutable identity remain ineligible. A normal deployment of the drain-capable release must precede later replacement. VM/Supabase flows must not implicitly upgrade/rebuild a differentSHA or fabricate receipts; exit0/SSHtimeout is not proof. Offline fencing/backup recovery is separate scope.

Final pre-gate full run7: 163 test files passed, 3 skipped; 2020 tests passed, 45 skipped. Required local PG/S3 and lifecycle suites executed. Lint/typecheck/format/build and strict OpenSpec validation passed; six Linux acceptance tests and actual consumer wire check passed. Gate, archival/draft publication/screenshot uploads, one-commit consolidation and final-head CI remain pending.

## Verified archive checkpoint and pending delivery

Implementation verification completed on exact gate head `225e19d9fd36fbc1b61b0e68280e01b36d25952d`: all seven GitHub checks passed in run [45306385338](https://github.com/drh-14/ChalkTalk/actions/runs/45306385338), including compose-smoke with 440 PG/S3 tests passed and six optional skips. A fresh full local suite on that head passed 2,025 tests (45 optional skips), and all three targeted real mocked-API browser scenarios passed with fresh screenshots. The no-mistakes run `01M858DAZGCJN152TK68B4V7DT` reached checks-passed and supported handed_off.

The two CI failures were diagnosed and repaired, not waived: the lost-claim test used an obsolete SQL interception after worker review fixes; it now changes actual database ownership. Process integration tests incorrectly used liveness `/health` as readiness; they now wait for `/ready`. Both repairs are included in the green head. Review also corrected resource-close error propagation, actual-effect uncertainty classification, drain initiation for uncertain API writes, and test quality.

Task 7.3 deliberately remains incomplete at archive: final one-commit consolidation, lease-protected update, final-head CI, and screenshot/description handoff are still pending. The user explicitly approved archiving with this administrative delivery bookkeeping pending; this is not a validation waiver or a completed-delivery claim. No live production replacement/callsite activation was performed or verified.

Before owned-branch reconciliation, the clean exclusive branch at `0f55b418c0137c6694cb4788771a61fc7bdfd1a0` and complete gate history at `225e19d9fd36fbc1b61b0e68280e01b36d25952d` were preserved under `archive/lifecycle-submitted-before-reconciliation-0f55b418` and `archive/lifecycle-gate-complete-225e19d9`, respectively. The original planning and initial staging refs remain intact. A verified complete bundle is stored at `/Users/darrenh/.t3/lifecycle-delivery-evidence/lifecycle-both-histories.bundle`. `git range-diff 31b9ab74..0f55b418 1edff8ed..393e1afb` reports the original implementation patch identical after gate rebase onto #276. Following supported gate handoff and explicit user authorization, only the owned lifecycle branch was realigned to the exact published green head; its tree was verified identical. No gate internals, shared branch, security callsite or other worktree was changed.
