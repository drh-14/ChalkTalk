## Context

Implement the approved independent main-based organized-resource architecture. Course information is a separate PR, not a dependency.

## Goals / Non-Goals

Instructor-created sections, named links/files, staff visibility, stable identity, ordering/replacement and safe deletion. No OCR, external fetching or document extraction.

## Decisions

- Migration029 creates sections, catalog state, resources and immutable revisions. Backfill live legacy file/link IDs where possible, all class-visible and ungrouped; no generated sections. Optional migration-only discovery excludes syllabus associations when an independently deployed information table exists.
- GET resources retains limit/cursor and adds manual/title/date sorting and optional section filter, returns catalogVersion and resource version/section/visibility. Course/sort/filter/catalog-version-bound cursors reject stale snapshots. Effective visibility is filtered before pagination. Staff sections are omitted for students; hidden reads404.
- Section collection GET/POST, conditional section PATCH/DELETE and PUT order; resource conditional PATCH/DELETE, PUT order, named-link POST and multipart POST files / PUT :id/file replacement. Same-course current instructors only; archived mutations409. Require existing authentication/Origin/CSRF, conditional version428/412; titles max200 Unicode characters and validated HTTP(S) URLs max2048. Sections are all instructor-created. Removing a staff section moves items ungrouped with staff restriction retained.
- Section/resource reorder validates a complete duplicate-free set for that scope under a course lock and catalog If-Match. Metadata/replacement uses resource If-Match. Ordering has stable ID tie-breaks. Any catalog mutation increments collection version.
- Multipart metadata consists of bounded allowed text fields title, sectionId and visibility with the file; existing standalone multipart remains file-only. File creation uses the shared narrow transaction callback, binds idempotency to metadata/course/actor and atomically associates visibility before commit. Existing file formats/100MiB apply.
- Composite same-course section/file and active-revision foreign keys validate at transaction commit so course-owned cascading deletion can remove the interconnected catalog atomically without weakening committed referential integrity.
- Catalog owns immutable revision references; replacing or deleting hides prior file URLs and queues unreferenced old objects for existing worker deletion. Active references block standalone uploader deletion. File read policy authorizes the actual persisted course and effective current resource visibility, including legacy listing/download URLs. New standalone uploads are not silently cataloged.
- Browser keeps existing resources navigation; headings and file-title/link lists grouped under explicitly created sections, optional ungrouped area, instructor create/manage/move/order controls, filename/title-click download rather than a separate button; retain application button design. Independent additive integration with Course information tabs.

## Risks / Trade-offs

No atomic object-store/database transaction: retain approved best-effort cleanup and ambiguous-commit retention. Reference checks and shared course/file locks prevent deletion races; removed/demoted users lose visibility without relying on client roles.

## Verification

Tests-first API+isolated PostgreSQL/Seaweed at actual public boundaries; lifecycle, idempotency, migration, stale/race/cleanup and direct legacy authorization. Real Chromium mocked-API screenshots for empty/custom/ungrouped/management/visibility/archive/error/mobile. Full checks and no-mistakes before one-commit draft PR.
