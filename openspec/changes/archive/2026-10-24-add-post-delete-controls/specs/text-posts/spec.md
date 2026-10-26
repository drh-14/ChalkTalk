## ADDED Requirements

### Requirement: Authorized post deletion is available in the course discussion UI

For an active, readable, non-merged post, the course discussion detail SHALL offer Delete post to its current author or current course TA/instructor. It SHALL not offer the action to other students, on an archived course, or for a confirmed merged source. Staff SHALL have no blind-delete UI for posts they cannot read. The action SHALL require an explicit confirmation and use the existing `DELETE /api/v1/posts/{postId}` with the current post ETag and session CSRF token. On `204`, the UI SHALL remove the post from the loaded feed and navigate to the discussion list. On cancel or failure, it SHALL keep the post visible and preserve any unsaved post-edit text; on `412`, it SHALL fetch the latest readable post version before retry, without overwriting local editor text. It SHALL display the API error for `409` and other failed deletes.

#### Scenario: Staff deletes a readable post

- **WHEN** a current TA confirms Delete post on a readable active post with its current version
- **THEN** the browser sends conditional DELETE and removes the post from the feed after `204`

#### Scenario: Student cannot delete another author's post

- **WHEN** a student reads another member's post
- **THEN** Delete post is not offered

#### Scenario: Cancel, conflict, or failed delete

- **WHEN** the author cancels confirmation or the API returns `409` or `412`
- **THEN** the post remains visible, unsaved edits are preserved, and the conflict or error is explained without navigating away
