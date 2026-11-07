# Proposal

## Why

Students often ask about a specific spot in the lecture slides, such as "On slide 14, why is the rotation left-heavy?". Today they have to describe that spot in words. Readers then open the PDF and hunt for it, and the next student confused by the same slide never sees the answer while reading it.

ChalkTalk already stores course PDFs and their text. It can let students point at the exact spot and keep the answer attached to that spot.

## What Changes

- **In-app PDF viewer.** Course PDF resources open in an in-app viewer with pages, zoom, and page navigation, instead of only downloading. The viewer has a right-hand panel listing the questions asked on the current page. Download stays available.
- **Ask about a spot.** In the viewer, a member drags a rectangle on a page and selects **Ask about this**. The panel opens the normal question composer with a cropped preview of the box. **Ask about this page** anchors to the whole page without dragging, for keyboard users and small screens.
- **Anchored posts are ordinary posts.**
  - Each one carries an anchor: the resource, the exact uploaded file version, the page, and the box as fractions of the page.
  - Anchored posts appear in the Discussion feed with a chip such as `Lecture 7 · p. 14`.
  - The post detail shows a crop of the anchored area and links back to that spot in the viewer.
  - The anchor is fixed once the post is created.
- **Markers.** Each anchored question shows as a marker on its page, and selecting a marker opens that question in the panel. Markers and panel lists include only posts the viewer may read, under the existing private, deleted, scheduled, and duplicate rules. Anonymous authors stay hidden.
- **Replaced slides.** When an instructor replaces a resource's file, earlier questions keep their anchor to the old version and say "asked on an earlier version of these slides". They are never shown at a wrong spot on the new file.
- **API.**
  - Create post accepts an optional `anchor` on questions and notes.
  - Post reads include the anchor.
  - A new course-scoped endpoint lists the anchored questions on a PDF resource.
- **New web dependency:** `pdfjs-dist` (Mozilla pdf.js, Apache-2.0), loaded only on the viewer route.
- PDFs only. Other resource types keep their current behavior.

## Capabilities

### New Capabilities

- `slide-anchored-questions`: the PDF viewer, anchoring a question to a box on a page, the anchor data and API, markers and the page question panel, feed and detail presentation, and replaced-file behavior.

### Modified Capabilities

- `organized-course-resources`: selecting a PDF upload in the catalog opens the in-app viewer instead of downloading it. Other uploads still download, and links open in a new tab.

## Impact

- **Database:** a new migration adds a `post_anchors` table with one row per anchored post. It references the post, the resource, and the immutable `course_files` row, and stores the page and the normalized box.
- **API:**
  - post creation validation;
  - the post read projections (feed, detail, related questions);
  - a new `GET /api/v1/courses/{courseId}/resources/{resourceId}/questions` endpoint;
  - the API reference, `documentation/openapi.yaml`, and `documentation/database.md`.
- **Web:**
  - a lazily loaded viewer route at `/courses/{courseId}/resources/{resourceId}/view`;
  - box drawing with pointer and touch input;
  - the page question panel, reusing the post composer;
  - feed chips, the detail crop, and the catalog link change.
- **Dependencies:** `pdfjs-dist` and its worker, bundled by Vite. No server-side PDF rendering, and no stored thumbnails.
- **Unchanged:** notifications, digests, search, and permissions. Anchored posts follow the existing post rules.
