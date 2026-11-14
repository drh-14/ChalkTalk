## MODIFIED Requirements

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

The viewer SHALL offer Original and Searchable copy versions in the same rendering surface, with original and ready searchable downloads. Switching versions SHALL preserve current page and zoom. Questions and Extracted text SHALL be selectable side panels on desktop. PDF extracted-text actions in the catalog SHALL open this viewer with text selected. Non-PDF text actions SHALL retain their existing behavior. Anchor coordinates SHALL remain bound to the original file; until page alignment is established for a searchable copy, its markers SHALL remain hidden and requesting an anchor SHALL switch to the original first. No PDF replacement SHALL silently change an open document or draft.

#### Scenario: Read text alongside slides
- **WHEN** a member opens a PDF's View extracted text action
- **THEN** the same PDF viewer opens with Extracted text selected and both PDF versions available

#### Scenario: Ask on an unaligned searchable copy
- **WHEN** a member requests to mark or ask about a page while viewing a copy without established anchor alignment
- **THEN** the viewer switches to the original before drawing or creating an original-file anchor

### Requirement: The viewer shows markers and a page question panel

Each listed question SHALL show as a numbered marker over its anchored area. The marker SHALL be distinguishable by more than color, SHALL be a keyboard-focusable control named for the question title, and SHALL distinguish answered questions from unanswered ones. Selecting a marker SHALL select its question.

The side panel SHALL list the current page's questions in page order, with:

- the selected question's title, a preview of its body, whether it is answered, and its count of open followups;
- an **Open in Discussion** link to the post;
- a count of earlier-version questions, linking to them in the Discussion feed.

Moving to another page SHALL update the panel without changing the selection's page. On narrow screens PDF, Questions and Extracted text SHALL be selectable tabs, each with one principal scrolling area. The active viewer SHALL fit the available viewport below the actual responsive header. A marked area SHALL open its composer in Questions; returning to PDF SHALL preserve page, zoom and draft. Touch scrolling SHALL remain normal outside explicit marking mode.

#### Scenario: A member checks what others asked

- **WHEN** a member opens page 14, which has two anchored questions
- **THEN** two numbered markers appear on the page, the panel lists both, and selecting marker 2 selects the second question and highlights its box

#### Scenario: A deep link to a question

- **WHEN** a member opens the viewer with `?page=14&post=p9`
- **THEN** page 14 is shown with question p9 selected and its box highlighted

Question loading SHALL distinguish initial loading, failed requests with Retry, successfully empty results and loaded results. Failure SHALL leave the PDF usable; background failure SHALL retain previous questions and markers with a refresh notice. Visible viewers SHALL refresh every 15 seconds, on tab return and after posting or returning from Discussion, without flashing loading or changing the draft, selected question, page or zoom. Hidden viewers SHALL pause interval refresh. Replacement SHALL show a slides-changed notice and explicit reload guarded against discarding unsaved work.

#### Scenario: Failed question request
- **WHEN** questions cannot be fetched
- **THEN** an error and Retry appear instead of an empty-result claim, while the PDF stays usable

#### Scenario: Refresh while composing
- **WHEN** another member adds or answers a question and the visible viewer refreshes
- **THEN** markers update without resetting the current draft, page, zoom or selection

#### Scenario: Replaced document while reading
- **WHEN** refresh detects a different current file
- **THEN** the reader sees a reload notice and keeps the displayed original and draft until explicitly reloading

#### Scenario: Mobile composer navigation
- **WHEN** a phone reader marks a region then switches between PDF and Questions
- **THEN** the selected region, current page, zoom and unfinished composer are preserved without competing page and panel scroll areas
