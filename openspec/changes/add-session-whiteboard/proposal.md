# Proposal

## Why

ChalkTalk's proposal describes office hours as needing "a shared code editor / whiteboard". Live code sessions now cover the editor, but a TA explaining recursion, a linked list, or an integral needs to sketch it. Students and staff currently have to leave ChalkTalk for another whiteboard tool, which loses the session's privacy and its record.

## What Changes

- Add a **Whiteboard** tab next to **Code** in every live code session. Both tabs belong to the same session, so participants, invitations, privacy, ending, and lifecycle rules are shared, and switching tabs does not reconnect.
- The whiteboard uses Excalidraw: freehand pen, rectangle, ellipse, diamond, line, arrow, and text, plus eraser, selection and move, undo and redo, colors, and stroke styles. Concurrent edits from all participants merge live.
- Participants see each other's pointers on the board, labeled with their real names and the same colors as their code cursors.
- Anyone in the session can **export the board as PNG**.
- When a session ends, the whiteboard becomes read-only and stays viewable with its final drawing, like the code.
- The collaboration server validates whiteboard edits. It accepts only an allowlist of drawing element types (no images, embeds, iframes, or frames), rejects links other than `http(s)`, and enforces element count, element size, and total board size limits. Invalid edits are rejected before they are applied or broadcast.
- The session snapshot API returns the whiteboard's elements alongside the code, so ended sessions and reconnecting clients can show the final board.
- Excalidraw's fonts and assets are served from ChalkTalk instead of a third-party CDN, and the whiteboard code loads only when the tab is first opened.
- With a whiteboard in them, sessions are no longer only about code, so the product calls them **live sessions**. The API and database names (`collaboration-sessions`) stay as they are.
- The session view is reorganized for the work: both tabs share one full-height workspace; tab actions (language and **Copy code**, or **Export PNG**) sit in the tab bar; **End session** moves to the header; participants show their presence color and an **Invite** button replaces the always-open form. Excalidraw's library browser and AI tools are hidden, since they contact third-party services.
- Smaller session improvements from the follow-ups list: Escape lets keyboard users Tab out of the code editor; a **Live session active** link near the post title; and the session language defaults from the post's tags.

Not in this change: image upload or paste onto the board, embedded web content, multiple boards per session, a whiteboard without a code session, and libraries or templates.

## Capabilities

### New Capabilities

None. The whiteboard is part of live code sessions.

### Modified Capabilities

- `live-code-sessions`: sessions gain a shared whiteboard document with server-side validation, named pointers, PNG export, read-only display after ending, and a whiteboard projection in the snapshot. This capability is introduced by `add-live-code-sessions`, which must merge first; this change builds on it.

## Impact

- **Web:** a Code/Whiteboard tab bar in `SessionView`; a lazily loaded `Whiteboard` component wrapping `@excalidraw/excalidraw`; a Yjs binding module; Excalidraw asset hosting through Vite.
- **Collaboration server:** validation of the `whiteboard` shared map in `beforeSync`, and storing the whiteboard projection with the text projection.
- **API and database:** the snapshot response gains `whiteboard` (an array of elements); `collaboration_documents` gains a `whiteboard_projection jsonb` column in a new migration.
- **Docs:** the collaboration-session API reference, OpenAPI, WebSocket protocol, and database reference.
- **Dependencies:** `@excalidraw/excalidraw` (MIT) in the web workspace. About 2 MB of JavaScript loads only when the whiteboard tab opens, and about 14 MB of fonts are fetched on demand from ChalkTalk's own origin.
- **Coordination:** depends on the open `add-live-code-sessions` PR; the migration is numbered after it.
