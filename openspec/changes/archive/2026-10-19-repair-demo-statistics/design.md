## Context

The runtime services already record statistics transactionally. Direct seed SQL omits those writes. Daily counts have no per-post provenance, so partial aggregate repair cannot be inferred safely.

## Decisions

Initial seed writes question daily counts and answer creation contributions using the original creation timestamps. Repeat runs serialize with the existing seed lock and briefly lock the two statistics tables against concurrent inserts. Repair only when both course-specific tables are empty, deriving records from persisted demo content. If either has data, leave both unchanged and report that repair was skipped. Never create view events. Preserve course timestamps and all credentials.

Use the existing Markdown/KaTeX renderer; change only fixture math bodies. The user additionally approved formatting-only repair of exact original existing fixture bodies and explicitly chose to keep current and historical endorsements. Match reserved course, fixture post title/type/author and exact old body; for answers also match kind and contributor identity. Update only body and version once; preserve timestamps, contributors, badges, endorsement history, views and activity. User-edited or already formatted bodies remain unchanged. The course lifecycle lock covers all repairs, and deleting courses remain untouched. Verify actual rendered seed content rather than inspecting source escapes.

## Verification

Real PostgreSQL isolated-schema seed tests observe StatisticsService and persistence constraints for fresh seed, legacy seed, repeat/concurrent runs, existing counts, and rollback. Render fresh and repaired database-emitted math in a real browser with mocked API without recapturing screenshots. No production backfill or API behavior changes.

## Dedicated student login

Add Riley Nguyen at riley.nguyen@ams161.mock.chalktalk.invalid using a reserved fixture UUID/email. AMS161_DEMO_STUDENT_PASSWORD is optional; when provided validate 12–128 characters before writes, otherwise use the same discarded random fallback as existing mock users. Fresh seed creates this student without any activity. Existing complete demo seed adds only a missing reserved account/student membership under the existing transaction/advisory lock. Matching existing account identity, credentials and edited display name remain untouched; mismatched IDs/email/organization, deleted identities or conflicting non-student membership fail rather than adopt/reset an account. A legacy organization marker without the reserved course remains unchanged. Statistics and formatting repairs remain independently conservative.

Verify through real isolated-schema AuthService, CourseService and StatisticsService seams plus repeat/concurrent seed and collision/rollback checks. Only after tests, provision the local login with an ignored environment key; never commit credentials or print unrelated environment values.

Existing-body formatting repair is now explicitly authorized with endorsements retained; report changed and skipped counts, and increment only changed row versions to protect stale saves.
