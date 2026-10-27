# Public course Threads

> **Name:** This contract replaces the old, unimplemented Channels contract. The file retains its historical path for documentation links; the product and API call the feature **Threads**. There are no Channels or subchannels in the deployed data model.

A Thread is a public, staff-created topic board for informal course coordination. Every current course member can browse and read all its conversations. A conversation starts with a required, identified Markdown opening message and has chronological replies, not a separate title or nested reply tree. Threads do not create teams, categories, invitations, private audiences, anonymous messages, scheduled archives, or email activity.

## Shared rules

- Browser authentication uses `Cookie: __Host-chalktalk_session=<opaque-session>`. Every unsafe request also requires an allowed HTTPS `Origin` and the session-bound `X-CSRF-Token`; JSON writes require `Content-Type: application/json`. Read responses and attachment downloads are `Cache-Control: private, no-store`.
- Current course membership is checked on every list, detail, catch-up, attachment, and live request. An absent/hidden resource or a former member receives `404 not_found`; an unauthenticated request receives `401 authentication_required`. Archived courses remain readable but return `409 course_archived` for mutations, including watch/read-state and attachment changes.
- Staff means a current TA or instructor. Only staff create, rename, or delete a Thread. An author can edit/delete their own message; staff may additionally edit/delete a message authored while its author was a student, even if that author was later promoted. Staff cannot edit another staff-authored message by role alone. Unauthorized mutation returns `403 permission_denied`.
- `If-Match: "vN"` is required for board rename/delete and message edit/delete; missing is `428 precondition_required`, stale is `412 version_conflict`. Board, conversation, and reply creates accept an optional `Idempotency-Key` for matching 24-hour retries and return `409 idempotency_key_reused` for conflicting reuse. Successful creates return `201 Created` and `Location`; detail and mutation responses with a version return an `ETag`. Validation failures are `422 validation_failed`. Lists use an opaque `cursor`, default `limit=30`, maximum 100; malformed cursors or limits return `400 invalid_request`.
- A deleted message is a bodyless, authorless placeholder: `deleted: true`, `bodyMarkdown: ""`, `author: null`, `authorRoleAtPosting: null`, and `attachments: []`, with ID, conversation ID, ordinal, timestamps, and version retained. No previous text or author identity is retained in the response. Its attachments are unavailable. In particular, deleting the opening message does not delete its conversation or replies. Deleting a whole Thread immediately hides all dependent content and queues file cleanup.

## Boards and conversations

| Method   | Path                                                                           | Access | Request                              | Success                                                   |
| -------- | ------------------------------------------------------------------------------ | ------ | ------------------------------------ | --------------------------------------------------------- |
| `GET`    | `/api/v1/courses/{courseId}/threads?cursor=&limit=`                            | Member | —                                    | `200 {data: ThreadBoard[], page: {hasMore, nextCursor}}`  |
| `POST`   | `/api/v1/courses/{courseId}/threads`                                           | Staff  | `{title}` (1–200 trimmed characters) | `201 {data: ThreadBoard}`                                 |
| `GET`    | `/api/v1/courses/{courseId}/threads/{threadId}`                                | Member | —                                    | `200 {data: ThreadBoard}`                                 |
| `PATCH`  | `/api/v1/courses/{courseId}/threads/{threadId}`                                | Staff  | `{title}`, `If-Match`                | `200 {data: ThreadBoard}`                                 |
| `DELETE` | `/api/v1/courses/{courseId}/threads/{threadId}`                                | Staff  | `If-Match`                           | `204`                                                     |
| `GET`    | `/api/v1/courses/{courseId}/threads/{threadId}/conversations?cursor=&limit=`   | Member | —                                    | `200 {data: Conversation[], page: {hasMore, nextCursor}}` |
| `POST`   | `/api/v1/courses/{courseId}/threads/{threadId}/conversations`                  | Member | `{bodyMarkdown}`                     | `201 {data: Conversation, openingMessage: ThreadMessage}` |
| `GET`    | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}` | Member | —                                    | `200 {data: Conversation}`                                |

`ThreadBoard` has `id`, `courseId`, `title`, `version`, `createdAt`, `updatedAt`, and a viewer-specific `unreadCount` where listed or retrieved. `Conversation` has `id`, `threadId`, `createdAt`, `updatedAt`, and a viewer-specific `unreadCount`; list and detail responses also include its `openingMessage` (the create response carries that message beside `data`). Creation of a conversation and its opening message is atomic. New conversations do not notify the entire course. Threads remain separate from the Posts feed and daily digest.

## Messages

| Method   | Path                                                                                                   | Access                     | Request                      | Success                                                    |
| -------- | ------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `GET`    | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/messages?cursor=&limit=` | Member                     | —                            | `200 {data: ThreadMessage[], page: {hasMore, nextCursor}}` |
| `POST`   | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/messages`                | Member                     | `{bodyMarkdown}`             | `201 {data: ThreadMessage}`                                |
| `GET`    | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/messages/{messageId}`    | Member                     | —                            | `200 {data: ThreadMessage}`                                |
| `PATCH`  | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/messages/{messageId}`    | Author or qualifying staff | `{bodyMarkdown}`, `If-Match` | `200 {data: ThreadMessage}`                                |
| `DELETE` | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/messages/{messageId}`    | Author or qualifying staff | `If-Match`                   | `204`                                                      |

`ThreadMessage` has `id`, `conversationId`, chronological `ordinal`, `bodyMarkdown`, `author: {id, displayName} | null`, `authorRoleAtPosting`, `attachments`, `createdAt`, `updatedAt`, `version`, and `deleted`. Bodies are nonanonymous Markdown, at most 100,000 characters. A reply is flat and chronological. Posting another reply auto-creates a watch if one does not exist, but never silently re-enables notices after explicit unfollow.

## Watches, unread state, and notifications

| Method | Path                                                                                 | Request                     | Success                                  |
| ------ | ------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------- |
| `GET`  | `/api/v1/courses/{courseId}/threads/unread-count`                                    | —                           | `200 {data: {count}}`                    |
| `GET`  | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/watch` | —                           | `200 {data: {watching, noticesEnabled}}` |
| `PUT`  | Same `/watch` path                                                                   | `{noticesEnabled: boolean}` | `200 {data: {watching, noticesEnabled}}` |
| `POST` | `/api/v1/courses/{courseId}/threads/{threadId}/conversations/{conversationId}/read`  | `{messageIds: string[]}`    | `204`                                    |

Starting or replying creates a watch with notices enabled unless a prior watch says otherwise. Explicit unfollow sets `noticesEnabled: false`, retains the watch and exact per-message read state, and suppresses bell cards but **not unread counts**. Passive readers have no watch or unread count. Marking read accepts only the IDs actually loaded in the browser, not an entire conversation watermark. The Threads section badge totals watched unread messages, even in unfollowed conversations; board and conversation entries display subtotals. Dismissing a bell card does not mark a message read. Each new reply adds a `thread_reply_created` card for other eligible watchers; it opens the exact reply after membership revalidation. No Thread email is sent.

## Attachments

Upload occurs **after** message creation. Failure to upload does not erase saved text. Up to five live attachments per message, each at most 100 MiB, use the existing validated image/document types (`.pdf`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.docx`, `.pptx`).

| Method   | Path                                                 | Request                                                       | Success                                                           |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `POST`   | `/api/v1/thread-messages/{messageId}/attachments`    | `multipart/form-data` with `file`; author or qualifying staff | `201 {data: ThreadAttachment}`                                    |
| `GET`    | `/api/v1/thread-attachments/{attachmentId}/download` | Current member with live board/message                        | Stream bytes, private/no-store, `X-Content-Type-Options: nosniff` |
| `DELETE` | `/api/v1/thread-attachments/{attachmentId}`          | Author or qualifying staff                                    | `204`                                                             |

`ThreadAttachment` has `id`, `fileName`, `mediaType`, `sizeBytes`, `createdAt`, and `downloadUrl`. Upload may use `Idempotency-Key` for a 24-hour retry window. Hidden or deleted attachments return `404 not_found`; archived courses allow downloads but reject upload/delete with `409 course_archived`. Every download checks current membership and live content rather than issuing a public long-lived URL.

## Live WebSocket and catch-up

Connect to `wss://<api-origin>/api/v1/thread-events` with the current session cookie and an allowed browser `Origin`. This is a separate API-owned socket from live-session whiteboards. It carries **signals and transient presence, not content writes**. REST remains the authority; a disconnected browser can refresh manually.

| Direction                      | JSON envelope                                                  | Effect                                                                       |
| ------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Client → server                | `{type:"subscribe", courseId}`                                 | Authorize current course membership.                                         |
| Server → client                | `{type:"subscribed", courseId}`                                | Subscribe before REST catch-up.                                              |
| Server → client                | `{type:"changed", courseId, boardId, sequence}`                | A committed change exists; fetch through REST. No message body or file data. |
| Client → server                | `{type:"view", courseId, conversationId}`                      | Mark this socket as currently viewing a conversation.                        |
| Server → client                | `{type:"viewing", conversationId}`                             | View subscription accepted.                                                  |
| Client → server                | `{type:"unview", conversationId}`                              | Leave that view.                                                             |
| Client → server                | `{type:"typing", conversationId, active:boolean}`              | Reply-composer-only pulse or stop.                                           |
| Server → other current viewers | `{type:"typing", conversationId, userId, displayName, active}` | Ephemeral named indicator, scoped to this conversation only.                 |
| Server → client                | `{type:"error", code}`                                         | Rejected action.                                                             |

Only people currently viewing the **same conversation** receive “X is typing.” Identity is derived from the session; no draft text, keystrokes, or file details travel. Typing expires after roughly ten seconds without a pulse and is never stored, replayed, emailed, added to the bell, or counted unread.

After `subscribed`, and after reconnect, call `GET /api/v1/courses/{courseId}/threads/changes?after=<opaque>&limit=<1..100>`; the response is `{data: [{sequence, boardId, kind, entityId}], page: {hasMore, nextCursor}}`. The cursor advances only from REST responses. Missed or duplicate WebSocket signals cannot lose committed changes; every catch-up page independently checks current membership. A former member's old socket grants no read access.
