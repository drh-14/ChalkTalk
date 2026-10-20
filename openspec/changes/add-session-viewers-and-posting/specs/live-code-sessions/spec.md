# Spec Delta

## ADDED Requirements

### Requirement: Participants can be invited as viewers

An invitation SHALL carry a permission, `edit` (the default) or `view`. A session's participants SHALL each report their permission; the creator SHALL always have `edit`. Course TAs and instructors SHALL always be able to edit, whatever permission they were invited with. Inviting someone who is already a participant SHALL leave their permission unchanged; to change it, the creator or staff remove and re-invite them. A connection ticket SHALL have `read` permission for a viewer and `write` permission otherwise, and the ticket response SHALL state it. The collaboration server SHALL treat a `read` connection as read-only: the viewer receives the document and others' presence live, may publish presence, and none of their document updates are applied or broadcast. The session view SHALL show a viewer that they are viewing only, keep the code editor and whiteboard read-only for them, and mark viewers in the participant list.

#### Scenario: A TA demos to two students

- **WHEN** a TA invites two students as viewers and types in the editor
- **THEN** both students see the code as it is typed, their view says it is view-only, and anything they type is not applied

#### Scenario: A modified client sends an update as a viewer

- **WHEN** a viewer's client sends a document update anyway
- **THEN** the update is not applied to the session or broadcast to others

### Requirement: Session work can be posted to the discussion

When the session's post is a question in an active course and the viewer can edit the session, the session view SHALL offer **Post to discussion** on both tabs. Posting code SHALL create a followup on the question whose body is an optional note followed by the session's current code in a fenced code block labeled with the session language, using a fence that the code itself cannot close. Posting the whiteboard SHALL create a followup with the optional note, or a default line naming the session, and attach the board's PNG export as an image. TAs and instructors SHALL also be able to post to the question's staff answer instead: if there is none it SHALL be created, and otherwise the content SHALL be appended to it with a version-checked edit. Posts SHALL use the viewer's name, not anonymity. After posting, the view SHALL confirm with a link to the post.

#### Scenario: A TA posts the fixed code as the answer

- **WHEN** a TA chooses **Post to discussion** on the Code tab, picks the staff answer, and adds "Fixed: the loop now breaks."
- **THEN** the question's staff answer contains the note and the code in a fenced Python block

#### Scenario: A student posts the diagram

- **WHEN** a student posts the whiteboard to the discussion
- **THEN** the question gains a followup by the student with the board attached as a PNG image

#### Scenario: A session on a note

- **WHEN** a session's post is a note
- **THEN** **Post to discussion** is not offered

### Requirement: Tests cover viewers and posting

API tests SHALL cover inviting with each permission, the default, an invalid permission, unchanged permission on re-invitation, the participant field, and ticket permission for viewers, staff invited as viewers, and editors. Collaboration server tests SHALL show a viewer receiving updates while their own updates are neither applied nor broadcast. Component tests SHALL cover the invite permission choice, the viewer state, the post dialog's destinations by role, the fenced body, appending to an existing staff answer, and the board attachment upload. A browser test SHALL show a viewer following an editor's typing without being able to edit.

#### Scenario: A viewer's edit leaks

- **WHEN** a change lets a viewer's update reach other participants
- **THEN** an automated test fails
