# Live code sessions: follow-ups

Known gaps and improvements after the first version of live code sessions (OpenSpec change `add-live-code-sessions`). Sizes are rough; "OpenSpec" marks changes large enough to need a proposal under `AGENTS.md`.

## Gaps

| #   | Gap                                                                                                          | Proposed fix                                                                                    | Size         |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------ |
| 1   | Invitees are not told they were invited; they only find a session by opening its post or receiving the link. | An "Invited to you" list on home and course pages, plus an invitation email sent by the worker. | Medium       |
| 2   | Staff have no course-wide view of active sessions during office hours.                                       | A staff list of the course's active sessions. The list API already supports course scope.       | Small–medium |
| 3   | Sessions nobody ends stay active indefinitely.                                                               | The worker ends sessions after a configurable period with no connected participants.            | Small        |
| 4   | No limits on session creation or ticket requests per user.                                                   | Rate limits alongside the existing login and signup limits.                                     | Small        |
| 5   | Tab is bound to indent in the code editor, so keyboard-only users cannot Tab out of it.                      | Let Escape release Tab (CodeMirror tab-focus mode) and show a visible hint.                     | Small        |

Items 1 and 2 belong together as one change ("session invitations and staff overview").

## Improvements

| #   | Improvement                                                                                                       | Size         |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| 6   | "Copy code" and "Post as answer or followup", so session code joins the searchable discussion.                    | Small–medium |
| 7   | A "Live session active" indicator near the post title linking to the session, since the panel sits below answers. | Small        |
| 8   | Read-only viewers, using the existing `read` ticket permission, for live demos to a whole class.                  | Medium       |
| 9   | Default the session language from the post's tags.                                                                | Tiny         |
| 10  | Collaboration server metrics (connections, store latency, revocations) in the existing Prometheus/Grafana stack.  | Small        |

## Larger changes (each needs OpenSpec)

| #   | Change                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- |
| 11  | Several files per session instead of one document.                                                  |
| 12  | Sandboxed code execution (for example Piston or Judge0). A security project in its own right.       |
| 13  | A shared whiteboard. In progress next.                                                              |
| 14  | Multiple collaboration nodes with Redis replication, so one process failure does not drop sessions. |
