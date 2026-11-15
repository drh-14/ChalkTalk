# Design

## Context

- **PDF display today.** The resource catalog downloads every upload when its title is selected. Searchable PDF copies show in an `<iframe>` with the browser's built-in viewer, which a page cannot draw on.
- **Serving files.** Original bytes come from `GET /api/v1/courses/{courseId}/files/{fileId}/download`. That route is same-origin, needs a session, and checks membership and staff-only visibility.
- **Data model.** Catalog resources (`course_resources`) point to their active revision (`course_resource_revisions`), which points to an immutable `course_files` row. Replacing a resource selects a new revision and file. The old file is hidden immediately and its bytes are cleaned up later.
- **Posts.** Posts are created through `PostService.create` and read through several projections (feed, detail, search, related questions). Those projections share the visibility rules for private, deleted, scheduled, and duplicate posts.
- **Web app.** It already lazy-loads heavy views: the whiteboard is a `React.lazy` chunk. It sets no Content-Security-Policy, so a same-origin pdf.js worker needs no header changes.
- **Earlier design.** The deferred `resource_regions` design in `documentation/database.md` is for staff-defined OCR regions with titles. That is a different purpose; it is not used here.

## Goals / Non-Goals

**Goals:**

- A fast, accessible in-app viewer for course PDFs, loaded only when someone opens one.
- Questions anchored to a box on a page, readable as ordinary posts everywhere posts appear.
- Anchors that never point at the wrong content after slides are replaced.
- No new server-side rendering, image storage, or background jobs.

**Non-Goals:**

- Anchors on non-PDF files, text-range highlights, freehand ink, or private personal notes.
- Moving or re-anchoring a question after creation, or migrating old anchors onto a replacement file.
- Showing answers and followups inside the viewer. The panel links to the Discussion for the full thread.
- Thumbnails on feed cards. Only the post detail renders a crop.
- Real-time marker updates for other viewers. Markers refresh when the viewer opens, and after the viewer's own post.

## Decisions

### 1. The anchor is a separate table with one row per post

- **Schema.** The new `post_anchors` table holds:
  - `post_id`, the primary key, with `(course_id, post_id)` referencing `posts(course_id, id)`;
  - `resource_id`, referencing `course_resources(course_id, id)`;
  - `file_id`, referencing `course_files(course_id, id)`;
  - `page`, an integer from 1 to 10,000;
  - `box_x`, `box_y`, `box_width`, and `box_height`, as `double precision` fractions of the page;
  - `created_at`.
- **Constraints.** Check constraints enforce the ranges, a minimum size of 0.01, and `x + width ≤ 1` and `y + height ≤ 1`.
- **Index.** `(course_id, file_id, page)` serves the questions list.
- **Alternative considered:** columns on `posts`. Rejected because most posts have no anchor, and a separate table keeps the anchor immutable by construction: edits never touch it.
- **Why fractions rather than PDF points.** Fractions make rendering independent of zoom and page size. The page's crop box defines the coordinate space, and pdf.js reports that size consistently. Rotated pages are measured after rotation, in the orientation the reader sees.

### 2. The anchor is pinned to the immutable file, and status is derived on read

- **Status on read.** `status` is computed at read time by comparing `file_id` with the resource's active revision file and applying the reader's visibility. Nothing is rewritten when a resource is replaced or deleted.
- **File cleanup.** It is unaffected. Anchors reference `course_files` rows, which are logically hidden and never hard-deleted while referenced. Their bytes may disappear, which is why `earlier_version` shows no crop.
- **Alternative considered:** keeping old bytes alive for anchored files. Rejected because it would contradict the catalog rule that replacing a file hides the old one.

### 3. Creation validates against the current revision inside the post transaction

`PostService.create` takes an optional `anchor`. Inside the existing create transaction, it locks the resource row (`FOR SHARE`) and checks four things:

- the resource is live and readable by the author, using the catalog's visibility function;
- its active revision is an `upload`;
- the file's media type is `application/pdf`;
- the active file equals `anchor.fileId`.

A missing, hidden, or non-PDF resource gives `422 validation_failed`, so a hidden resource is indistinguishable from a missing one. A different current file gives `409 resource_changed`. Polls and announcements reject anchors with `422`. The idempotency fingerprint includes the canonical anchor. Post edits accept no `anchor` field, so the anchor cannot change after creation. Task 2.3 confirms how the edit route treats an unexpected `anchor` field and pins that behavior in a test.

### 4. One anchor projection is shared by every post read

A helper joins `post_anchors` with the resource, its active revision, and its section to compute `status`, `resourceTitle`, and IDs. It is added to the shared projection queries, so feed, detail, search, and related questions all agree. Visibility uses the same predicate the catalog uses (live resource, item and section visibility, reader role), so `unavailable` never leaks a title.

### 5. A dedicated questions endpoint for the viewer

`GET /api/v1/courses/{courseId}/resources/{resourceId}/questions` first authorizes the resource as the catalog read does (`404` when hidden). It then selects anchored posts on the active file through the feed's visibility predicate. Per-reader `unread` and the `answered` and `resolved` flags come from the existing feed columns. It is capped at 500 entries, which is far above a realistic deck, and returns `earlierVersionCount` from the same predicate on non-current files.

A filter on the feed endpoint was considered instead. The feed is cursor-paginated and sorted by activity, while the viewer needs all of a file's anchors in page order with boxes. A small endpoint is simpler and cheaper.

### 6. pdf.js renders in the browser, behind a lazy route

- **Library.** Use `pdfjs-dist@4.10.38`, Apache-2.0 and published January 2025, which is old enough to be stable. Its worker is bundled with Vite (`pdf.worker.min.mjs?url`), so it is served same-origin.
- **Loading.** The viewer is a `React.lazy` chunk, so other pages don't pay for pdf.js. The document is fetched from the existing original-download route with credentials, and the bytes are passed to `getDocument({ data })`. This avoids range-request support, which that route does not have.
- **Rendering.**
  - Pages render to canvas at device pixel ratio. There is no text layer: a pointer drag on a page draws a box, which would conflict with text selection, and the catalog's extracted text already serves search.
  - Only pages near the viewport render.
  - Pages scroll vertically, and each page has a fixed-size placeholder computed from its viewport, so nothing jumps while loading.
- **Crop in the post detail.** The detail loads the same document lazily, renders the anchored page at a scale that makes the box about 480px wide, and copies the box into a smaller canvas. The crop is cached in memory per post for the session.

### 7. Box drawing uses pointer events on an overlay

- **Input.** A transparent overlay per page captures `pointerdown`, `pointermove`, and `pointerup` with pointer capture, so mouse, pen, and touch work alike.
- **Touch.** On touch, a drag starting on the overlay draws a box only in "Ask" mode, so ordinary scrolling still works. Phones get an **Ask** toggle in the toolbar; on wide screens dragging always draws.
- **Small boxes.** Boxes under 1% of the page's width or height are discarded as clicks.
- **Keyboard.** **Ask about this page** gives the full-page box `{0, 0, 1, 1}`.

### 8. The side panel reuses the post composer

The panel hosts the existing `PostComposer`, in question or note mode, with an `anchor` prop. That keeps tags, folders, anonymity, attachments, drafts policy, and validation identical to the Discussion. The panel shows the crop preview above the composer. After a successful create, it inserts the returned post into the panel list and markers, selects it, and offers **Open in Discussion**.

### 9. The catalog link change is limited to PDFs

In the catalog, upload entries whose file media type is `application/pdf` link their title to the viewer route and gain a Download action. Other uploads and links behave as today. The `/courses/{courseId}/resources/{resourceId}/view` route joins the course page's resources section, so the shared course header and tabs stay visible.

## Risks / Trade-offs

- **Large PDFs are fetched whole.** The download route has no range support, so a 100 MiB deck downloads fully before rendering. *Mitigation:* show progress, and render page 1 as soon as the document parses. Range support can be added to the route later without changing the viewer.
- **Bundle size.** pdf.js is about 1 MB plus its worker. *Mitigation:* both load only on the viewer and on opened anchored posts.
- **Crop rendering cost in post detail.** *Mitigation:* render only the anchored page, at a bounded scale, once per post per session.
- **Coordinates on unusual PDFs.** Pages can have different sizes and rotations. *Mitigation:* fractions over the rotated viewport, with browser tests on a rotated page and on mixed page sizes.
- **Accessibility of a visual feature.** Markers are labeled buttons, the panel lists questions as text, Ask about this page needs no pointer, and crops carry alternative text.
- **Marker density.** Many questions on one area could overlap. *Mitigation:* numbered markers offset slightly when boxes coincide, and the panel list is always the complete, ordered alternative.
- **Archived and read-only courses.** The viewer stays readable and the composer is hidden, matching existing post creation rules.
