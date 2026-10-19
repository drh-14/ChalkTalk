## Context
PR53 already implements actual course file listing and immutable file upload/download. The revised approved scope includes named external links in the same flat Resources list.

## Goals / Non-Goals
Add minimal links and unified presentation, preserving file identities and all lifecycle contracts. No file wrapper/backfill, attachments changes, categories, sections, descriptions, visibility modes, OCR, search or link deletion UI/API.

## Decisions
Use course_resource_links(id,course_id,title,url,created_by_user_id,created_at), course cascade and nullable user attribution on deletion. Title must be trimmed, nonblank and at most 200 Unicode code points; URL must be an absolute HTTP(S) URL at most 2048 Unicode code points with a host and no credentials, raw Unicode whitespace (including surrounding whitespace), C0/C1 controls or backslashes. Percent-encoded bytes and ordinary non-ASCII paths remain valid. Store validated input without fetching it. Instructor-only active-course POST /courses/:id/resources accepts exactly {kind:'link',title,url}, returns201 with public link metadata and Location pointing to the unified collection. Optional 1–255 character Idempotency-Key binds creator/course/input for24h within one transaction; changed input409. Existing upload/download/delete/list remain unchanged.
GET /courses/:id/resources authorizes current membership and active/archived status, then UNION ALL live course_files and links. Metadata is discriminated by kind:'upload'|'link'; no storage keys/checksum/creator attribution. Order created_at DESC,id DESC,kind DESC and use exact PostgreSQL microsecond timestamps in strict endpoint+course-bound cursors. Default25,limit1–100; reject unknown/repeated query fields and malformed/foreign cursors400. Link title opens target_blank with noopener noreferrer; filename itself downloads via existing authenticated endpoint, without separate Download text. React uses(kind,id)identity. Forms retain per-selection/submission retry keys, feedback and duplicate-submit guards; errors preserve list.

## Risks / Trade-offs
Links can point anywhere HTTP(S); no server network fetch or preview means no server SSRF. External navigation has an explicit new-tab indication. Pagination is deterministic, not a snapshot during concurrent changes. Creator deletion preserves shared links via SET NULL; course deletion cascades.

## Verification
Tests first at public HTTP/isolated PostgreSQL and actual Chromium with mocked API. Link integration is independent of S3. Verify mixed paging, microseconds and equal IDs, strict query/body/URL validation, auth,Origin/CSRF, membership/archive/deleting isolation, idempotency and constraints. Preserve file regression tests. Capture mixed/list/paging/form/error/readonly/mobile screenshots. Run full checks, archive new change and fresh no-mistakes, update same draftPR53 with exactlyone final commit and final-head CI.
