## Context
Use the approved course-information/resources architecture. This change remains independently based on main and contains no organized-resource schema.
## Goals / Non-Goals
Current members read descriptive information and current staff. Instructors edit active courses. Office hours are text, not appointment booking.
## Decisions
- `GET/PATCH /courses/:courseId/information` returns a versioned information model; empty courses return version 1 without creating rows on reads. PATCH requires If-Match and JSON containing descriptionMarkdown and website. Text limit 50,000 Unicode characters; absolute HTTP(S) website max 2,048, without credentials, whitespace or controls.
- `GET /courses/:courseId/staff` lists current instructors/TAs only. `PATCH /courses/:courseId/staff/:userId` conditionally saves contact/location/officeHours, each at most 2,000 Unicode characters. Membership controls names/roles; no account email is implicitly exposed. Empty profiles return version 1.
- `PUT/DELETE /courses/:courseId/information/syllabus` require information If-Match and active same-course instructor permission. Multipart replacement reuses validated 100 MiB/eight-format file transport with a transactional association hook. Failure retains the old file. Removal/replacement hides and queues cleanup only for unreferenced old files.
- All reads require current authenticated membership in the actual course. Archived reads work, writes conflict; deleting/nonmember reads are hidden 404. Return private,no-store and ETags; unsafe routes require existing Origin/CSRF checks. No client role grants permission.
- A composite syllabus foreign key prevents cross-course association. File and course locks serialize association with deletion. Standalone deletion of a referenced syllabus returns 409 file_in_use. Worker checks references before physical removal.
- Secondary tabs inside existing Course resources route keep Resources initially selected; use existing Markdown editor/renderer and responsive accessible forms with preserved drafts on stale saves.
## Risks / Trade-offs
Upload validation happens before association commit. Existing best-effort cleanup/ambiguous-commit policy remains. Shared file guards must preserve independent uploader permissions. Rosters join current names/roles and suppress deleted users.
## Verification
Tests first at authenticated HTTP+real isolated PostgreSQL and existing S3 seam; real Chromium with mocked API for member/instructor empty/populated/edit/upload/error/stale/desktop/mobile. Focused and repository checks, no-mistakes, one-commit draft PR.
