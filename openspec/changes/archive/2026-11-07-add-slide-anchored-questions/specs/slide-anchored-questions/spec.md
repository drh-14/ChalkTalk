## Purpose

Lets course members read course PDFs inside ChalkTalk and ask questions anchored to a marked area of a page, so each question and its answers stay attached to the exact spot in the slides they concern.

## ADDED Requirements

### Requirement: Course PDFs open in an in-app viewer

A member who can read an upload resource whose current file is a PDF SHALL be able to open it at `/courses/{courseId}/resources/{resourceId}/view`. The viewer SHALL:

- render the PDF's pages inside the page;
- provide previous and next page controls, a page number entry, fit-to-width, and zoom in and out;
- provide a Download control for the original file;
- accept a `page` query parameter that opens that page, and a `post` query parameter that also selects that anchored question.

A missing, deleted, or hidden resource, or one that is not a PDF upload, SHALL show the same not-found state without revealing whether it exists. While the PDF loads, the viewer SHALL hold its layout and announce the loading. If the file cannot be loaded or rendered, it SHALL show a retryable error that keeps Download available. The viewer SHALL be usable in archived courses.

#### Scenario: A student opens lecture slides

- **WHEN** a student opens a class-visible PDF resource from the catalog
- **THEN** the viewer shows its first page with page navigation, zoom, and Download, and the page question panel beside it

#### Scenario: A link opens a specific page

- **WHEN** a member follows `/courses/c1/resources/r1/view?page=14`
- **THEN** the viewer opens on page 14

#### Scenario: A student opens a staff-only PDF by URL

- **WHEN** a student requests the viewer for a PDF in a staff-only section
- **THEN** the not-found state appears and no file bytes are requested

### Requirement: Members anchor a question to an area of a page

In an active course, a member who can read the PDF SHALL be able to drag a rectangle on a rendered page with a mouse, pen, or touch, and then choose **Ask about this**. A rectangle smaller than 1% of the page's width or height SHALL be ignored. **Ask about this page** SHALL anchor to the whole current page without dragging, so the feature works by keyboard alone.

Either action SHALL open the post composer in the viewer's side panel with a cropped preview of the anchored area. The composer SHALL offer the question and note types and the same title, body, tags, folder, anonymity, attachment, and course-policy rules as the Discussion composer. It SHALL not offer polls or announcements. Canceling the composer, or confirming the discard of unsaved text, SHALL clear the rectangle.

After the post is created, it SHALL appear as a marker on its page and in the panel without reloading. The composer SHALL not be offered in archived courses.

#### Scenario: A student asks about a diagram

- **WHEN** a student drags a box around a tree diagram on page 14, chooses Ask about this, and posts a question
- **THEN** the question is created with that anchor, a marker appears over the box, and the panel lists it under page 14

#### Scenario: A keyboard user asks about a page

- **WHEN** a keyboard user moves to page 3 and activates Ask about this page
- **THEN** the composer opens with a preview of the whole page, and the posted question is anchored to all of page 3

#### Scenario: An accidental click

- **WHEN** a member clicks a page without dragging
- **THEN** no box is kept and the composer does not open

### Requirement: The post API accepts and validates an anchor

`POST /api/v1/courses/{courseId}/posts` SHALL accept an optional `anchor` on question and note posts, with these fields:

- `resourceId`: the resource;
- `fileId`: the resource's current file;
- `page`: an integer from 1 to 10,000;
- `box`: `x`, `y`, `width`, and `height` as fractions of the page, each from 0 to 1, with `x + width ≤ 1`, `y + height ≤ 1`, and `width` and `height` each at least 0.01.

The API SHALL return `422 validation_failed`, with the offending `anchor` field in `details`, when:

- an anchor is supplied on a poll or an announcement;
- a field is malformed or out of range;
- the resource is not an upload resource the author can currently read whose file is a PDF.

The response SHALL be the same whether the resource is missing, deleted, or hidden from the author. When `fileId` is not the resource's current file, the API SHALL return `409 resource_changed` and create nothing.

An anchor SHALL be fixed for the post's lifetime: post edits SHALL not accept or change it. Idempotent replays SHALL compare the anchor as part of the request.

#### Scenario: A valid anchored question

- **WHEN** a student creates a question with an anchor to page 14 of a readable PDF's current file
- **THEN** the API returns `201` with the post and its anchor

#### Scenario: The slides were replaced while composing

- **WHEN** an instructor replaces the PDF after the student opened it, and the student then submits with the old `fileId`
- **THEN** the API returns `409 resource_changed` and no post is created

#### Scenario: A box outside the page

- **WHEN** a request supplies a box with `x` 0.8 and `width` 0.5
- **THEN** the API returns `422 validation_failed` naming the anchor box

#### Scenario: A student anchors to a staff-only resource

- **WHEN** a student supplies the ID of a staff-only PDF resource
- **THEN** the API returns `422 validation_failed`, as it would for a missing resource

### Requirement: Post reads include the anchor

Every post projection the API returns (feed, detail, search, and related questions) SHALL include `anchor` for an anchored post and `null` otherwise. The anchor SHALL contain `page`, `box`, and `status`:

- `current`: the anchored file is still the resource's current file, and the reader can read the resource;
- `earlier_version`: the resource has since been given another file, and the reader can read the resource;
- `unavailable`: the resource is deleted or hidden from the reader.

For `current` and `earlier_version`, the anchor SHALL also include `resourceId`, `fileId`, and the resource's current `resourceTitle`. For `unavailable`, these SHALL be omitted, so no title of a hidden resource is revealed.

#### Scenario: A staff-only resource

- **WHEN** a student reads a question anchored to a PDF that has since moved into a staff-only section
- **THEN** the anchor has status `unavailable` and no resource title or IDs

#### Scenario: Replaced slides

- **WHEN** a member reads a question anchored to a file the instructor later replaced
- **THEN** the anchor has status `earlier_version` with the resource's current title

### Requirement: The API lists a PDF's anchored questions

`GET /api/v1/courses/{courseId}/resources/{resourceId}/questions` SHALL return, to members who can read the resource, the anchored posts on its current file that the caller may read. It SHALL apply the same rules as the feed:

- private posts for their author and staff only;
- deleted posts excluded;
- unpublished scheduled posts excluded;
- confirmed duplicates excluded.

Each entry SHALL include the post `id`, `type`, `title`, `page`, `box`, `unread`, and `createdAt`, and for questions `answered` and `unresolvedFollowups`. Entries SHALL be ordered by page and then creation time, with at most 500 entries. The response SHALL also return the `resourceId`, the current `fileId` (which new anchors must name), and `earlierVersionCount`, the number of readable posts anchored to earlier files of the resource.

The response SHALL be private and not cached. A missing, deleted, hidden, or non-PDF resource SHALL return `404 not_found`, and absent authentication `401 authentication_required`.

#### Scenario: Private questions on shared slides

- **WHEN** student A lists questions on a PDF where student B asked a private question
- **THEN** student B's question is not listed for student A, but is listed for course staff

#### Scenario: Questions after replacement

- **WHEN** two questions were asked on an earlier file and one on the current file
- **THEN** the list contains the current-file question and reports `earlierVersionCount` 2

### Requirement: The viewer shows markers and a page question panel

Each listed question SHALL show as a numbered marker over its anchored area. The marker SHALL be distinguishable by more than color, SHALL be a keyboard-focusable control named for the question title, and SHALL distinguish answered questions from unanswered ones. Selecting a marker SHALL select its question.

The side panel SHALL list the current page's questions in page order, with:

- the selected question's title, a preview of its body, whether it is answered, and its count of open followups;
- an **Open in Discussion** link to the post;
- a count of earlier-version questions, linking to them in the Discussion feed.

Moving to another page SHALL update the panel without changing the selection's page. On narrow screens the panel SHALL follow the page instead of sitting beside it.

#### Scenario: A member checks what others asked

- **WHEN** a member opens page 14, which has two anchored questions
- **THEN** two numbered markers appear on the page, the panel lists both, and selecting marker 2 selects the second question and highlights its box

#### Scenario: A deep link to a question

- **WHEN** a member opens the viewer with `?page=14&post=p9`
- **THEN** page 14 is shown with question p9 selected and its box highlighted

### Requirement: The Discussion shows where an anchored question points

In the Discussion feed, an anchored post's card SHALL show a chip with the resource title and page, such as `Lecture 7 · p. 14`. An `earlier_version` chip SHALL add "earlier version". An `unavailable` chip SHALL say "Slides unavailable" without a title.

The post detail SHALL show, above the body:

- for `current`: a cropped image of the anchored area, rendered from the PDF in the browser, and a **View on slides** link to the viewer at that page with the post selected;
- for `earlier_version`: the page number with "asked on an earlier version of these slides" and a link to the current slides, without a crop;
- for `unavailable`: "The slides for this question are no longer available."

Crops SHALL load only when the post detail is shown, never for feed cards. They SHALL have alternative text naming the resource and page, and SHALL hold their space while rendering.

#### Scenario: A TA reads an anchored question

- **WHEN** a TA opens an anchored question in the Discussion
- **THEN** the detail shows the cropped diagram from page 14 and a View on slides link that opens the viewer with the question selected

#### Scenario: The feed stays light

- **WHEN** the feed lists 25 posts, 6 of which are anchored
- **THEN** the 6 cards show resource and page chips, and no PDF is downloaded until a post is opened
