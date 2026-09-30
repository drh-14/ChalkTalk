## MODIFIED Requirements

### Requirement: Members can filter and sort the course feed

The discussion route SHALL show a filter sidebar, a landmark named "Post filters", with single-choice filters exposed as pressed and unpressed buttons. All posts SHALL come first and be the default, with no filter parameter. Three filters that apply to every type SHALL be nested beneath All posts:

- **My posts:** `authorId` set to the signed-in member; shown only when the signed-in member is known.
- **Instructor posts:** `authorRole=instructor`.
- **TA posts:** `authorRole=ta`.

The remaining filters SHALL be generated from the frontend's list of known post types. Each known type SHALL follow, using that type's list filter, and a filter that applies only to one type SHALL be listed directly beneath that type as a nested filter. For the current types, the order SHALL be:

- **All posts**, then **My posts**, **Instructor posts**, and **TA posts** nested beneath it.
- **Questions** (`type=question`), then nested beneath it:
  - **Answered** (`answered=true`).
  - **Unanswered** (`answered=false`).
  - **Pinned** (`type=question&pinned=true`).
- **Notes** (`type=note`), then **Pinned** (`type=note&pinned=true`) nested beneath it.

Filters that share a visible label SHALL have distinct accessible names, such as "Pinned questions" and "Pinned notes". A type SHALL be added to the list only once the API accepts it as a list filter. The sidebar SHALL also offer a Sort by control with these options:

- **Last updated:** `sort=recent_activity`; the default when no search is applied, and then the browser omits `sort` from the request.
- **Newest:** `sort=newest`.
- **Oldest:** `sort=oldest`.
- **Best match:** `sort=relevance`; offered only while a search is applied, and the default then.

A sort chosen during one applied search SHALL apply only to that query; a new or cleared search SHALL return to its default. Changing the filter or sort SHALL reset pagination and ignore stale responses exactly as a query change does. Load more SHALL keep the active filter and sort. In staff duplicate review, the filters and sort SHALL be disabled and SHALL not affect review requests. Filter and sort are not stored in the URL. On screens at or below 850px, the filters SHALL appear as a wrapping row of buttons above the feed, with nested filters shown as ordinary buttons, and SHALL be hidden while a post is selected.

#### Scenario: A member sees filters for each post type

- **WHEN** a signed-in member opens the discussion route
- **THEN** the sidebar lists All posts, My posts, Instructor posts, TA posts, Questions, Answered, Unanswered, Pinned, Notes, and Pinned in that order, with All posts pressed

#### Scenario: A member shows unanswered questions

- **WHEN** a member selects Unanswered
- **THEN** the browser requests the course feed with `answered=false`, marks Unanswered as pressed and All posts as not pressed, and replaces the list with the returned questions

#### Scenario: A member shows posts by instructors or TAs

- **WHEN** a member selects Instructor posts, then TA posts
- **THEN** the browser requests the course feed with `authorRole=instructor`, then with `authorRole=ta`

#### Scenario: A member shows pinned notes

- **WHEN** a member selects the Pinned filter beneath Notes
- **THEN** the browser requests the course feed with `type=note` and `pinned=true`, and only that Pinned filter is pressed

#### Scenario: A member sorts oldest first

- **WHEN** a member chooses Oldest
- **THEN** the browser requests the course feed with `sort=oldest`

#### Scenario: A member loads more filtered posts

- **WHEN** a member loads the next page while a filter is active
- **THEN** the next request carries the cursor together with the same filter and sort

#### Scenario: Best match is offered only while searching

- **WHEN** a member with no applied search opens the sort control
- **THEN** only Last updated, Newest, and Oldest are offered, and Best match appears and becomes selected once a search is applied

#### Scenario: Staff review duplicates

- **WHEN** a TA or instructor switches the post view to Duplicate posts
- **THEN** the sidebar's filters and sort are disabled
