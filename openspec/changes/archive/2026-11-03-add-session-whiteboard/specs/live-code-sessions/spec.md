# Spec Delta

## MODIFIED Requirements

### Requirement: Participants edit one shared document in real time

Connected participants SHALL edit a single shared plain-text code document and a single shared whiteboard. Concurrent edits from any number of participants SHALL merge so that every connected participant converges to the same text without losing either side's insertions. An edit SHALL appear for the other connected participants within 1 second under normal local conditions. The code document SHALL be limited to 200,000 characters. The server SHALL reject, without applying or broadcasting it, an update that would exceed that limit, that writes any shared structure other than the code text and the whiteboard, or that violates the whiteboard rules. Each participant SHALL see the other connected participants' display names, a distinct color, and their cursor and selection positions. Presence identity SHALL come from the authenticated ticket, not from the client.

#### Scenario: Two people type at the same place

- **WHEN** a student and a TA type different text at the same position at the same moment
- **THEN** both insertions appear in the same order for both of them, and neither is lost

#### Scenario: A participant sees who is editing

- **WHEN** a TA joins a session a student already has open
- **THEN** the student sees the TA's name in the participant list and the TA's cursor in the editor

#### Scenario: A client writes an unknown shared structure

- **WHEN** a client sends an update that creates a shared structure other than the code text or the whiteboard
- **THEN** the server rejects it without applying or broadcasting it and closes that connection with reason `invalid-update`

### Requirement: Members can start and join sessions from a post

The product SHALL call these sessions **live sessions** in everything users see. The post detail view SHALL list the post's sessions that the viewer may open, showing each session's title, language, status, and participant names, and SHALL offer **Start live session** for posts where creation is allowed. While the viewer can open an active session on the post, the post header SHALL show a **Live session active** link to it. Starting a session SHALL let the member choose a language and optional title, with the language defaulting to the first of the post's tags that names a supported language (otherwise plain text), then open the session view. The session view SHALL be routed at `/courses/{courseId}/sessions/{sessionId}`, work as a direct link for authorized participants, and show an unavailable state otherwise. It SHALL contain a code editor with line numbers and syntax highlighting for the session language, the participant list with presence, an invite control (creator and staff only) that selects from current course members, a language control (creator and staff only), an **End session** control (creator and staff only), a link back to the post, and a visible connection state: connecting, connected, reconnecting, ended (read-only), or access removed. Before a member starts a session, the view SHALL tell them that participants will see their name.

#### Scenario: A student starts a session and invites a TA

- **WHEN** a student opens a question tagged `python`, chooses **Start live session**, keeps the suggested Python, and invites a TA
- **THEN** the session view opens with an empty Python editor, the TA appears as invited, and the question lists the session and shows **Live session active**

#### Scenario: The connection drops briefly

- **WHEN** a participant's network drops for a few seconds and returns while the session is still active and they are still invited
- **THEN** the view shows "reconnecting", obtains a new ticket, reconnects, and merges edits made while disconnected without losing them

#### Scenario: An uninvited member opens a session link

- **WHEN** a course member who is not authorized opens a session URL
- **THEN** the view shows an unavailable state without the session's title, text, or participants

## ADDED Requirements

### Requirement: The session view uses its space for the work

The Code and Whiteboard tabs SHALL share one workspace of the same height, filling the window below the session header on wide screens, so switching tabs does not move the page. Actions for the selected tab SHALL sit in the tab bar: the language control (creator and staff) and **Copy code** for Code, and **Export PNG** for Whiteboard. The session language SHALL be shown only with the Code tab. **End session** SHALL sit in the session header beside the connection state. The participant list SHALL show each participant's initial in their presence color, mark who is online, including the viewer while connected, and offer invitations through an **Invite** button that opens the member picker. The whiteboard SHALL not offer Excalidraw's library browser or its AI and diagram-generation tools.

#### Scenario: A TA copies the student's code

- **WHEN** a TA on the Code tab chooses **Copy code**
- **THEN** the session's current text is on the clipboard and the view confirms it was copied

#### Scenario: A connected participant sees themselves online

- **WHEN** a student is connected to a session alone
- **THEN** the participant list marks the student as online in their presence color

### Requirement: Keyboard users can leave the code editor

In the code editor, Tab SHALL indent. Pressing Escape SHALL make the next Tab or Shift+Tab move focus out of the editor, and the editor SHALL show a visible hint saying so while it has focus.

#### Scenario: A keyboard user tabs out

- **WHEN** a keyboard user in the editor presses Escape and then Tab
- **THEN** focus moves to the next control after the editor without inserting a tab

### Requirement: Sessions include a shared whiteboard

Every live code session SHALL have a shared whiteboard, reached through a **Whiteboard** tab beside the **Code** tab in the session view. Both tabs SHALL use the session's single connection, participants, access rules, and lifecycle; switching tabs SHALL neither reconnect nor lose unsaved local changes. Participants SHALL be able to draw freehand; create rectangles, ellipses, diamonds, lines, arrows, and text; select, move, resize, and delete elements; change stroke and fill colors and stroke style; and undo and redo their own changes. Concurrent whiteboard edits SHALL merge per element: edits to different elements SHALL all be kept, and concurrent edits to the same element SHALL converge to the same result for every participant. A participant's undo SHALL not revert other participants' changes. The whiteboard SHALL start empty.

#### Scenario: Two people draw at once

- **WHEN** a student draws a rectangle while a TA draws an arrow on the same whiteboard
- **THEN** both participants see both the rectangle and the arrow within 1 second

#### Scenario: Switching tabs keeps the connection

- **WHEN** a participant drawing on the whiteboard switches to the Code tab and back
- **THEN** the connection state stays "Connected" and the drawing is unchanged

#### Scenario: Undo affects only your own edits

- **WHEN** a TA presses undo after a student's latest edit
- **THEN** the TA's own last edit is undone and the student's edit remains

### Requirement: The collaboration server validates whiteboard edits

The collaboration server SHALL accept a whiteboard update only if every element it adds or changes is one of `rectangle`, `ellipse`, `diamond`, `line`, `arrow`, `freedraw`, or `text`; any other element type, including images, embeds, iframes, and frames, SHALL be rejected. An element's `link` SHALL be absent, null, or an absolute `http` or `https` URL of at most 2,048 characters. Elements SHALL not carry file references or `customData`. A single element SHALL serialize to at most 64 KiB, a `freedraw` element SHALL have at most 10,000 points, and a text element SHALL have at most 10,000 characters. The whiteboard SHALL hold at most 5,000 elements, counting deleted ones, and the whole document SHALL encode to at most 5 MiB. A rejected update SHALL not be applied or broadcast, and the connection SHALL close with reason `invalid-update`.

#### Scenario: A client sends an image element

- **WHEN** a modified client adds an element of type `image` or `embeddable`
- **THEN** the server rejects the update, no participant receives it, and the stored whiteboard is unchanged

#### Scenario: A client adds a script link

- **WHEN** a client sets an element's link to `javascript:alert(1)`
- **THEN** the server rejects the update

#### Scenario: A board grows past its limit

- **WHEN** a client's update would bring the whiteboard above 5,000 elements
- **THEN** the server rejects it and the existing elements are unchanged

### Requirement: Participants see named pointers on the whiteboard

While on the whiteboard, each participant SHALL see the other connected participants' pointer positions, labeled with their display names in the same colors used for their code cursors. Pointer identity SHALL come from the authenticated connection, never from the client. A participant's pointer SHALL disappear within 5 seconds after they leave the whiteboard tab or disconnect.

#### Scenario: A TA watches a student sketch

- **WHEN** a student moves their pointer on the whiteboard
- **THEN** the TA sees a pointer labeled with the student's real name following that movement

### Requirement: The whiteboard can be exported as PNG

Any participant who can open the session, including after it ends, SHALL be able to export the whiteboard as a PNG image of all non-deleted elements on a white background. The download file name SHALL be derived from the session title. Export SHALL work without network access to anything other than ChalkTalk.

#### Scenario: A student saves the TA's diagram

- **WHEN** a student chooses **Export PNG** on the whiteboard of an ended session
- **THEN** the browser downloads a PNG that shows the board's final drawing

### Requirement: Whiteboard content is persisted, recovered, and read-only after ending

The whiteboard SHALL be persisted together with the code document, on the same schedule and with the same crash-loss bound. `GET /api/v1/collaboration-sessions/{id}/snapshot` SHALL return `whiteboard`: the array of the board's non-deleted elements as last persisted, in drawing order. A participant reconnecting after a collaboration server restart SHALL see the last persisted board. When a session ends, the whiteboard SHALL become read-only for every participant while remaining viewable, pannable, zoomable, and exportable, and SHALL show its final persisted elements.

#### Scenario: The session ends while someone is drawing

- **WHEN** staff end a session while a student has the whiteboard open
- **THEN** the student's whiteboard becomes read-only and shows the final drawing, and the snapshot's `whiteboard` lists those elements

### Requirement: Whiteboard assets are self-hosted and loaded on demand

The whiteboard SHALL load its code only when a participant first opens the Whiteboard tab, so pages without an open whiteboard do not download it. Fonts and other whiteboard assets SHALL be served from ChalkTalk's own origin; using the whiteboard SHALL not make requests to third-party hosts.

#### Scenario: A participant opens only the code tab

- **WHEN** a participant opens a session and stays on the Code tab
- **THEN** the browser has not downloaded the whiteboard bundle

#### Scenario: The whiteboard renders text offline from third parties

- **WHEN** a participant adds a text element while third-party hosts are blocked
- **THEN** the text renders with the whiteboard's fonts, served from ChalkTalk

### Requirement: Tests cover the whiteboard contract

Collaboration server tests SHALL cover whiteboard validation: each allowed type accepted; each disallowed type, unsafe link, file reference, `customData`, oversized element, point and text limits, element count, and document size rejected without broadcast. Unit tests SHALL cover the Yjs binding's per-element merge, deletion, and ordering. API tests SHALL cover the snapshot's `whiteboard` field. Unit tests SHALL cover mapping server-stamped awareness into named, colored whiteboard pointers, and collaboration server tests SHALL show a client-supplied pointer name being replaced. Component tests SHALL cover the tab bar, read-only mode after ending, and PNG export naming. A browser test SHALL show two participants drawing concurrently and each seeing the other's elements, and the whiteboard becoming read-only after the session ends. The browser test SHALL also show a participant seeing another participant's named pointer in that participant's presence color.

#### Scenario: Validation regresses

- **WHEN** a change lets an `iframe` element reach other participants
- **THEN** an automated test fails
