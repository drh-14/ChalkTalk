## MODIFIED Requirements

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters", with single-choice filters exposed as pressed and unpressed buttons. The filters SHALL be generated from the frontend's list of known post types. All posts SHALL come first and be the default, with no filter parameter. Each known type SHALL follow, using that type's list filter. A filter that applies only to one type SHALL be listed directly beneath that type as a nested filter. For the current types, the order SHALL be All posts, Questions (`type=question`), Unanswered (`answered=false`, nested under Questions), and Notes (`type=note`). A type SHALL be added to the list only once the API accepts it as a list filter. The sidebar SHALL also offer a Sort by control with these options:

- **Recent activity:** the default when no search is applied; the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter and sort. In staff duplicate review, the filters and sort SHALL be disabled and SHALL not affect review requests. Filter and sort are not stored in the URL. On screens at or below 850px, the filters SHALL appear as a wrapping row of buttons above the feed, with nested filters shown as ordinary buttons, and SHALL be hidden while a post is selected.

#### Scenario: A member sees filters for each post type

- **WHEN** a member opens the discussion route
- **THEN** the sidebar lists All posts, Questions, Unanswered, and Notes in that order, with All posts pressed

#### Scenario: A member shows unanswered questions

- **WHEN** a member selects Unanswered
- **THEN** the browser requests the course feed with `answered=false`, marks Unanswered as pressed and All posts as not pressed, and replaces the list with the returned questions

#### Scenario: A member loads more filtered posts

- **WHEN** a member loads the next page while a filter is active
- **THEN** the next request carries the cursor together with the same filter and sort

#### Scenario: Best match is offered only while searching

- **WHEN** a member with no applied search opens the sort control
- **THEN** only Recent activity and Newest are offered, and Best match appears and becomes selected once a search is applied

#### Scenario: Staff review duplicates

- **WHEN** a TA or instructor switches the post view to Duplicate posts
- **THEN** the sidebar's filters and sort are disabled

## ADDED Requirements

### Requirement: Post cards separate type, title, preview, and byline

Each ordinary post card in the feed SHALL show these elements in this order:

- **Header row:** a type badge immediately before the title, with the title's wrapped lines returning to the card's leading edge, and any status pills at the trailing edge.
- **Preview:** a plain-text excerpt limited to two lines.
- **Footer:** the viewer-projected author and the post's creation time together, with an optional type-specific summary at the trailing edge.

The title SHALL be the most prominent text on the card. The badge's label, icon, and color and the card's statuses SHALL come from the same post type list that generates the sidebar filters. Questions SHALL show Answered or Unanswered from the API's `answered` value. Any pinned post SHALL show Pinned. Notes SHALL show no answer status. A post whose type is not in the list SHALL render with a neutral "Post" badge and no type-specific status instead of failing. The detail pane SHALL label a post's type from the same list. When no post is selected, its prompt SHALL not name specific post types. Staff duplicate review cards keep their restricted title and merged-into content.

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
