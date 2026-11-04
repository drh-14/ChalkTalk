# Proposal

## Why

ChalkTalk's proposal names real-time collaboration as a core capability: during office hours a student and a TA should be able to open a shared code editor and edit the same code at once, with changes merging live. Today nothing supports this. The only editor is a single-user Markdown field, answer live editing was retired, and the collaboration-session API in `documentation/api/collaboration-sessions.md` is marked as an unimplemented future contract.

## What Changes

- Add **live code sessions**: a course member can start a temporary shared code editor from any post they can read. Participants edit one plain-text document together in real time, see each other's cursors and names, and changes merge without conflict.
- Make sessions **private**. Only the session creator, current course TAs and instructors, and course members explicitly invited by the creator or staff can find, open, or edit a session. This narrows the documented future contract, which allowed any course member.
- Add **invitations**: the creator or staff can invite and remove course members. Removing a participant disconnects them.
- Let the creator choose a **language for syntax highlighting** (plain text, Python, Java, C, C++, JavaScript, TypeScript, SQL), changeable during the session. The editor never runs code.
- Let the creator or staff **end** a session. Ended sessions become read-only and keep their final text, which authorized participants can still view and copy.
- Add a **collaboration server** process using Yjs over Hocuspocus. It authenticates each WebSocket with a short-lived, one-use ticket from the REST API, and saves the document to PostgreSQL every few seconds, when the last participant leaves, and when the session ends.
- Show on each post the sessions the viewer may open, add a **Start live code session** action, and add a full-page session view with the editor, a participant list, an invite control, the language picker, and connection status.
- Enforce lifecycle rules: archiving a course ends its sessions; deleting a post or course removes them; losing course membership revokes access and disconnects the user.
- Implement and update the REST contract (create, list, get, end, invitations, connection tickets, snapshot) in `documentation/api/collaboration-sessions.md`, `documentation/api/collaboration-websocket.md`, `documentation/openapi.yaml`, and `documentation/database.md`.

Not in this change: whiteboard or drawing, code execution, subchannel anchors (channels do not exist yet), multi-node collaboration servers, Redis, and session history or replay.

## Capabilities

### New Capabilities

- `live-code-sessions`: Private, post-anchored, temporary collaborative code-editing sessions: their REST lifecycle, invitations and access control, one-use WebSocket tickets, real-time merged editing with presence, snapshot persistence, and the browser experience for starting, joining, and ending them.

### Modified Capabilities

None. Course archive, post deletion, and course deletion effects on sessions are specified inside `live-code-sessions`; existing course and post behavior does not change.

## Impact

- **New service:** a collaboration server process (`apps/api/src/collaboration/`, started like the background worker) running Hocuspocus and Yjs, reached by the browser over a WebSocket proxied by Vite in development and added to Docker Compose.
- **API:** new REST routes under `/api/v1/courses/{courseId}/collaboration-sessions` and `/api/v1/collaboration-sessions/{id}`, including invitation routes that are not in the current contract.
- **Database:** a new migration adding the documented `collaboration_sessions`, `collaboration_documents`, and `collaboration_connection_tickets` tables, plus a `collaboration_participants` table and `language` and `title` columns. Course deletion cleanup must remove this data.
- **Web:** session entry points on the post detail page, a new session route and view, and a CodeMirror code editor with language modes, bound to Yjs with live cursors.
- **Dependencies:** `@hocuspocus/server`, `@hocuspocus/provider`, `y-codemirror.next`, `ws`, and CodeMirror language packages. `yjs` is already present.
- **Docs:** the collaboration-session API reference, WebSocket protocol reference, OpenAPI document, database reference, and README local-development steps.
- **Coordination:** migration numbering must avoid Darren's open branches, which use 016 and 017. The design doc stating that collaboration sessions are future work needs updating.
