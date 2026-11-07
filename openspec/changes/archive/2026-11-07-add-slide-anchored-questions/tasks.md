# Tasks

## 1. Anchor storage

- [x] 1.1 Add migration `059_post_anchors.sql` with the `post_anchors` table, same-course foreign keys to posts, resources, and files, range and minimum-size checks, and the `(course_id, file_id, page)` index. Verify: migrations run on a fresh schema, and an integration test shows the checks reject an out-of-page box and a 0.005-wide box.
- [x] 1.2 Document `post_anchors` in `documentation/database.md`, covering its keys, constraints, immutability, and status derivation. Verify: the entry matches the migration.

## 2. Post API

- [x] 2.1 Write integration tests from the spec for anchored creation. Verify: they fail before 2.2. They cover:
  - a valid anchored question and note;
  - an anchor on a poll or an announcement (`422`);
  - malformed and out-of-range fields (`422`, naming the field);
  - missing, deleted, staff-only-to-a-student, link, and non-PDF resources, all the same `422`;
  - a stale `fileId` (`409 resource_changed`, no post created);
  - idempotent replay with a changed anchor.
- [x] 2.2 Accept and validate `anchor` in post creation inside the create transaction, and store it. Verify: the 2.1 tests pass.
- [x] 2.3 Pin how post edits treat an `anchor` field, and test that edits never change a stored anchor. Verify: an integration test passes.
- [x] 2.4 Add the shared anchor projection (`status`, `resourceTitle`, IDs) to the feed, detail, search, and related-questions reads, with tests for:
  - `current`;
  - `earlier_version` after a replacement;
  - `unavailable` after deletion, and for a student after the PDF moves into a staff-only section, with no title or IDs;
  - `null` for unanchored posts.

  Verify: the integration tests pass.
- [x] 2.5 Update `documentation/api/posts.md` and `documentation/openapi.yaml` for the create anchor, its errors, and the read projection. Verify: the OpenAPI file parses, and the examples match the tests.

## 3. Questions endpoint

- [x] 3.1 Write integration tests from the spec for `GET /courses/{courseId}/resources/{resourceId}/questions`. Verify: they fail before 3.2. They cover:
  - ordering by page and then creation, and the entry fields;
  - private questions shown to their author and staff only;
  - deleted, scheduled, and confirmed-duplicate posts excluded;
  - `earlierVersionCount`;
  - `404` for missing, hidden, link, and non-PDF resources, and `401` without a session;
  - `Cache-Control: private, no-store`.
- [x] 3.2 Implement the route and service method. Verify: the 3.1 tests pass.
- [x] 3.3 Document the endpoint in `documentation/api/resources.md` and `documentation/openapi.yaml`. Verify: the OpenAPI file parses.

## 4. PDF viewer

- [x] 4.1 Add `pdfjs-dist@4.10.38` with its Vite-bundled worker and a lazily loaded viewer route at `/courses/{courseId}/resources/{resourceId}/view` inside the course page. Verify: the production build emits the viewer and worker as separate chunks, and other routes don't load them.
- [x] 4.2 Build the viewer. Verify: component tests cover the page and post query parameters, the not-found state, and the error state. It includes:
  - vertically scrolling pages with fixed placeholders and near-viewport rendering;
  - page navigation and page number entry;
  - fit-to-width and zoom;
  - Download;
  - loading, not-found, and retryable error states.
- [x] 4.3 Link PDF catalog titles to the viewer and add a Download action, leaving other uploads and links unchanged. Verify: catalog component tests cover a PDF entry, a DOCX entry, and a link entry.

## 5. Anchoring and the side panel

- [x] 5.1 Add box drawing on a per-page pointer overlay. Verify: unit tests for the coordinate conversion, and browser tests that draw a box by mouse and by touch. It includes:
  - the minimum-size click filter;
  - the touch Ask mode;
  - normalized coordinates over the rotated viewport;
  - Ask about this page.
- [x] 5.2 Add the side panel. Verify: component tests cover listing, selecting, posting, and the archived-course state. It includes:
  - the current page's questions;
  - the selected question with Open in Discussion;
  - the earlier-version count;
  - the composer with a crop preview, reusing the post composer in question and note modes, with the anchor attached;
  - inserting the new post into the list and markers after create;
  - handling `409 resource_changed` with a reload prompt.
- [x] 5.3 Add numbered, labeled, keyboard-focusable markers with answered and unanswered states and offsets for overlapping boxes, plus deep-link selection from `?page=&post=`. Verify: component tests and a browser test.

## 6. Discussion presentation

- [x] 6.1 Show the resource and page chip on feed cards for each anchor status. Verify: component tests confirm no PDF requests come from the feed.
- [x] 6.2 Show the post-detail anchor block. Verify: component tests cover each status, and a browser test checks the rendered crop. It includes:
  - a lazily rendered crop with alternative text and reserved space for `current`;
  - the earlier-version text and link;
  - the unavailable text;
  - the View on slides link.

## 7. Verification and evidence

- [x] 7.1 Add a browser spec with a mocked API and a real sample PDF. Save screenshots under `docs/pr-screenshots/slide-anchored-questions`. Verify: the spec passes. It covers, at desktop and phone sizes:
  - opening slides from the catalog;
  - drawing a box and posting;
  - markers and the panel;
  - a deep link;
  - the feed chip and the detail crop;
  - the earlier-version and unavailable states.
- [x] 7.2 Run the web and API test suites, typecheck, lint, and the mocked browser suite. Check the viewer by hand against a real CSE 214 lecture PDF in the local seed. Verify: all pass, apart from failures already known on `main`.
