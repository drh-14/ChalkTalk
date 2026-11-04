## MODIFIED Requirements

### Requirement: Post cards separate type, title, preview, and byline

Each ordinary post card in the feed SHALL show these elements in this order:

- **Header row:** a type badge inline immediately before the title, the title wrapping to at most two lines that return to the card's leading edge and end in an ellipsis when cut, and any status pills at the trailing edge.
- **Preview:** a compact rendered Markdown and LaTeX excerpt whose paragraphs run together as text, limited to two lines and ending in an ellipsis when cut.
- **Footer:** the viewer-projected author and the post's creation time together, with an optional type-specific summary at the trailing edge.
- **Tags:** the post's tags as chips, when it has any, below the footer and outside the card's link, starting at the same leading edge as the card's text.

The title SHALL be the most prominent text on the card. The badge's label, icon, and color and the card's statuses SHALL come from the same post type list that generates the sidebar filters. Questions SHALL show Answered or Unanswered from the API's `answered` value. Any pinned post SHALL show Pinned. Notes SHALL show no answer status. A post whose type is not in the list SHALL render with a neutral "Post" badge and no type-specific status instead of failing. The detail pane SHALL label a post's type from the same list and show the post's tag chips below the byline. When no post is selected, its prompt SHALL not name specific post types. Staff duplicate review cards keep their restricted title and merged-into content.

#### Scenario: A member scans an unanswered question

- **WHEN** the feed contains a question whose `answered` value is false
- **THEN** its card shows a Question badge beside the title, an Unanswered pill, a two-line preview, and the author with the creation time

#### Scenario: A member sees a pinned, answered question

- **WHEN** the feed contains a question that is answered and pinned
- **THEN** its card shows both Answered and Pinned pills

#### Scenario: A member sees a note

- **WHEN** the feed contains a note
- **THEN** its card shows a Note badge and no Answered or Unanswered pill

#### Scenario: The API returns a type the frontend does not know

- **WHEN** the feed contains a post whose type is not in the post type list
- **THEN** its card renders with a neutral Post badge and no type-specific status

#### Scenario: A tagged post is listed

- **WHEN** the feed contains a post tagged `midterm`
- **THEN** its card and its detail pane show a `#midterm` chip whose accessible name is "Filter by tag midterm"

#### Scenario: A long title and multi-paragraph body are listed

- **WHEN** the feed contains a post whose title and body are longer than the card
- **THEN** the badge sits on the title's first line, the title ends in an ellipsis within two lines, the preview joins the paragraphs and ends in an ellipsis within two lines, and the tag chips line up with the title

### Requirement: Staff can pin and unpin a post from the post view

When a TA or instructor views an ordinary post, the post action toolbar SHALL include a "Staff actions" group. It SHALL contain the existing Merge as duplicate control and, while the course is active, a Pin or Unpin button reflecting the post's `pinned` state. Activating it SHALL send the documented conditional post update with the post's current ETag and CSRF token, disable itself while pending, and update both the post view and that post's feed row on success. A failed update SHALL show the error and reload the post, so a stale revision is replaced. Students SHALL not see the Staff actions group, and no member SHALL see Pin or Unpin in an archived or deleting course.

#### Scenario: A TA pins a post

- **WHEN** a TA activates Pin on a post at version 3
- **THEN** the browser sends `pinned: true` with `If-Match: "v3"`, the button becomes Unpin, and the post's feed row shows Pinned

#### Scenario: A TA unpins a post in Last updated sort

- **WHEN** a TA unpins a post while the feed uses Last updated
- **THEN** the feed reloads without pin precedence, and the post follows its new update time

#### Scenario: A pin races another update

- **WHEN** the pin request returns `412 version_conflict`
- **THEN** the browser shows the error message and reloads the post

#### Scenario: A student views a post

- **WHEN** a student opens a post
- **THEN** no Staff actions group or Pin control appears

### Requirement: Authorized members edit posts explicitly

The post detail SHALL provide Edit to the author or course TA/instructor only while the course is active and the visible post is not a confirmed duplicate. Anonymous display identity SHALL NOT grant ownership. Editing SHALL preserve immutable post type and use the existing title, Markdown/LaTeX, tags and anonymity authoring controls. Text changes SHALL stay local until Save. Cancel SHALL return to view without committing unsaved text. Existing Pin and Merge controls SHALL remain unchanged. A merge SHALL ask before discarding a dirty edit, retain the editor and failed-file queue if the merge fails, and prevent editing while the merge is pending. The post Edit button SHALL follow "Post actions share one toolbar". Edit buttons for answers, root followups and replies SHALL use slightly increased padding and corner radius without changing their existing colors.

#### Scenario: Author edits a question or note

- **WHEN** an authorized member selects Edit, changes the draft and saves
- **THEN** a version-checked update persists the changes and returns to rendered view

#### Scenario: Read-only member views a post

- **WHEN** a different student or a member of an archived course views the post
- **THEN** no Edit or post file mutation controls appear, while existing images and document links remain readable

#### Scenario: Cancel or save failure preserves the correct text

- **WHEN** an editor cancels an unsaved draft or Save fails validation or network checks
- **THEN** Cancel leaves persisted text unchanged and a failed Save retains the draft for correction or retry

#### Scenario: Stale draft needs explicit review

- **WHEN** Save receives a version conflict
- **THEN** the draft remains intact and the editor can load the latest post for review before explicitly retrying

## ADDED Requirements

### Requirement: Post actions share one toolbar

The post view SHALL present its actions in one "Post actions" group placed after the byline and tag chips and before the rendered body. The group SHALL contain, in order and only when each is otherwise offered: Follow or Following, Edit post, the Staff actions group, and Delete post. Delete post SHALL be last, set apart from the other actions, and keep its danger color. Each action SHALL be a button of the same height showing a decorative icon before its existing text label. Icons SHALL be hidden from assistive technology, so accessible names stay the visible labels. Expanded controls such as the merge search, and action error messages, SHALL appear on their own line within the group. Permissions, pending and disabled states, confirmations, and requests SHALL remain unchanged.

#### Scenario: Staff read a question

- **WHEN** a TA opens an active question
- **THEN** one toolbar after the tags shows Follow, Edit post, Pin, Lock discussion, Merge as duplicate, and then Delete post, and the body follows it

#### Scenario: A student reads someone else's post

- **WHEN** a student opens another member's post
- **THEN** the toolbar shows only Follow

### Requirement: Feed status row sits above the list

The feed SHALL show one status row above, not within, the scrolling card list. That row SHALL hold the unread count with **Mark all read** when loaded posts are unread, and the passive new-post status when there are new posts. The row SHALL keep a stable height whether either item is shown, so cards do not move when items appear or disappear.

#### Scenario: Unread and new posts together

- **WHEN** the feed has unread posts and a new post arrives
- **THEN** the row above the list shows the unread count with Mark all read and `1 new post`, and the cards keep their position

### Requirement: Course tabs share one content width

The Threads, Collaboration, Course resources, Course settings, and Statistics tabs SHALL center their content in one shared maximum width, so switching tabs keeps the same left edge. The discussion tab keeps its full-width column layout.

#### Scenario: A member switches tabs

- **WHEN** a member on a wide screen moves between those tabs
- **THEN** each tab's content starts at the same left edge and has the same width

## REMOVED Requirements

### Requirement: Post Edit follows the rendered body

**Reason**: Edit moves into the shared post action toolbar above the body.

**Migration**: See "Post actions share one toolbar".
