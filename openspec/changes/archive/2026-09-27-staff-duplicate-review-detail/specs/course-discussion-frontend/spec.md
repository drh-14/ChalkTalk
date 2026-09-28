## ADDED Requirements

### Requirement: Staff can inspect the retained duplicate in the detail pane

In Duplicate posts mode, each source SHALL appear as a full-card, keyboard-accessible control with the same post-card styling and selected state as ordinary posts. Selecting the card SHALL fetch its staff-only review detail and show that source's full retained title, body, staff-visible author, and tags in the right pane, with a link to the canonical post and an unmerge action there. The left card SHALL contain no nested link or action. The merge-as-duplicate action SHALL NOT appear in this mode. Switching views or selecting a different source SHALL prevent stale detail from appearing. Unmerge SHALL use the current review version and clear the selection on success. Ordinary course members SHALL not see this review mode.

#### Scenario: Staff select a duplicate source

- **WHEN** a TA selects a duplicate from the left review list
- **THEN** the right pane shows that source, not the canonical post, and offers unmerge

#### Scenario: Staff switch away from review

- **WHEN** staff switch from Duplicate posts to Posts while review detail is loading
- **THEN** the stale review response is not displayed
