# Proposal

## Why

Two follow-ups for live sessions (items 6 and 8), plus the whiteboard idea the user picked (W4):

- **Read-only viewers.** A TA demoing to several students wants them to watch without everyone typing. Today every participant can edit.
- **Posting session work.** Whatever a session produces disappears into the session. The code and the whiteboard should be easy to post back to the question, where the rest of the class can find and search them.

The user chose invited viewers (sessions stay private) and posting as a followup, with staff also able to post as the staff answer.

## What Changes

- **Viewers.**
  - The creator or staff can invite a course member as a **viewer** instead of an editor; invitations default to edit.
  - A viewer's connection is read-only: they see the code, the whiteboard, cursors, and pointers live, but their edits are not accepted.
  - The participant list marks viewers.
  - Course staff always edit, and the creator always edits.
  - Changing someone's permission means removing and re-inviting them.
- **Post code.** On the Code tab, **Post to discussion** posts the current code, in a fenced block in the session's language with an optional note, as a followup on the session's question. Staff can choose the staff answer instead: it is created if the question has none, or the code is appended to it.
- **Post board.** On the Whiteboard tab, **Post to discussion** exports the board as PNG and posts it, with an optional note, as an image attachment on a new followup or on the staff answer (staff only).
- Posting is offered only when the anchor post is a question in an active course, and it uses the existing followup, answer, and attachment APIs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `live-code-sessions`: participant permissions (edit or view), read-only connections for viewers, and posting session code or the whiteboard to the discussion.

## Impact

- **Database:** migration `023_collaboration_participant_permission.sql` adds `collaboration_participants.permission`.
- **API:**
  - the invite body accepts `permission`;
  - participants include `permission`;
  - tickets are issued with `read` permission for viewers, and the ticket response includes `permission`.
- **Collaboration server:** read-ticket connections are read-only.
- **Web:**
  - the invite form gains a permission choice;
  - the participant list shows viewers;
  - the view-only state;
  - a post dialog on both tabs, using the existing answer, followup, and attachment clients.
- **Docs:** `collaboration-sessions.md`, `collaboration-websocket.md`, `openapi.yaml`, and `database.md`.
- **Coordination:** stacked on `add-session-limits`.
