# ChalkTalk design

## Purpose and scope

ChalkTalk is a course discussion and Q&A platform. Courses have structured posts for questions, notes, announcements, and polls; public Threads for informal conversations; course resources; and private live collaboration sessions. An optional Piazza import helps instructors migrate course data.

This document describes the implemented product and the approved single-VM deployment architecture. Detailed contracts and topology are in the [API references](api/), [database reference](database.md), and [architecture diagram](../diagrams/architecture/architecture.svg).

## Identity, courses, and access

A user registers with a verified `.edu` address, display name, and password. The school domain determines the user's organization; changing an address requires verification within the same domain. Password reset and account deletion are supported. Account deletion revokes sessions and removes identifying profile data while preserving course contributions with a deleted-user identity. See [authentication](api/auth.md) and [identity visibility](api/identity-visibility.md).

An instructor creates a course. Students join through the supported enrollment flow; instructors manage membership and roles. A course can be archived, making its discussion and live editing read-only, or deleted with its course-owned data. Each operation checks current course membership and role. Instructors control whether future anonymous contributions, private posts, and followup resolution are allowed; those switches apply to future content. See [courses](api/courses.md) and [memberships](api/course-memberships.md).

| Capability                                       | Student  | TA  | Instructor |
| ------------------------------------------------ | -------- | --- | ---------- |
| Create questions and ordinary notes              | Yes      | Yes | Yes        |
| Create announcements and polls                   | No       | Yes | Yes        |
| Endorse answers and manage post folders          | No       | Yes | Yes        |
| Delete a post they can read                      | Own post | Yes | Yes        |
| Create and manage a Thread board                 | No       | Yes | Yes        |
| Manage course membership, settings, or lifecycle | No       | No  | Yes        |

Staff moderate content within their authorized courses. Private posts are visible to their author and current TAs/instructors across lists, search, direct reads, and attachments.

## Posts and discussion

A course feed contains questions, notes, and polls. An announcement is a staff-created note with announcement behavior. A post may have tags and one optional staff-managed, flat folder. The feed supports search and filtering; its new-post notice lets the reader refresh the list. A new-post composer automatically restores one private, server-backed draft of text and metadata per user and course; successful posting clears its contents. See [posts](api/posts.md).

Questions have a shared student answer and a shared staff answer, plus followups and replies. Shared-answer edits use conditional version checks. Staff can endorse an answer. Members may follow or unfollow readable posts, and unread state is separate from email preferences. Staff can lock a question or poll to block new discussion and vote changes while leaving existing content readable. Staff may confirm a question as a duplicate of a canonical question and later undo that merge. See [answers](api/answers.md) and [posts](api/posts.md).

Ordinary questions and notes can be public or private. Polls and announcements are public-only. Posts and applicable responses may be anonymous while the course permits it; authorized staff can still see the author. Polls support single- or multi-select ballots, deadlines, manual or on-close result release, and aggregate-only results export. Results appear without ballot identities in the UI and CSV. See [posts](api/posts.md) and [identity visibility](api/identity-visibility.md).

Posts, answers, followups, and replies support Markdown and mathematical notation. Supported attachments are uploaded after their parent content is saved. The API checks current access before serving a file. Post and response edits use ETags/version checks to protect newer saves. The [concurrent-edit sequence](../diagrams/concurrent-edit-sequence/concurrent-edit-sequence.svg) illustrates this save model.

## Threads and live collaboration

A Thread is a public, staff-created course topic board for informal coordination, such as finding homework partners. Any current course member can start a conversation with an opening message, and members can reply chronologically. Message authors can edit or delete their messages, and staff can moderate contributions authored by students. A conversation starter or staff member can delete the whole conversation; staff can rename or delete the board. See [Threads](api/channels.md).

Watched conversations have unread counts. Members can unfollow reply notifications while retaining unread counts. The API's WebSocket sends live change signals, and clients fetch durable state through REST after a signal or reconnect. Typing indicators are ephemeral and visible to other people currently viewing the same conversation.

Collaboration sessions are course-scoped private shared code editors, independent of posts and Threads. Any current course member can create one. Only participants can discover it; a participant may invite another course member with View or Edit access. Hocuspocus and Yjs provide CRDT editing, presence, and cursors; a View invitation remains read-only even for staff. The creator or participating staff may manage or end a session. Ended sessions retain their last saved read-only snapshot, with a warning where final persistence could not be confirmed. See [collaboration sessions](api/collaboration-sessions.md) and [WebSocket protocol](api/collaboration-websocket.md).

## Resources, search, and statistics

Course Resources groups instructor-managed files and named external links under instructor-created sections, with ungrouped entries also supported. Sections and individual resources can be class-visible or staff-only. Current course members may read resources visible to their role; instructors manage sections, uploads, and links. The API checks membership and visibility before serving original file bytes. Catalog uploads support whole-file text extraction, including OCR for scanned PDF pages and images, and resource search uses titles and ready extracted text. See [resources](api/resources.md) and the [organized resources specification](../openspec/specs/organized-course-resources/spec.md).

Post search uses PostgreSQL full-text and fuzzy matching, scoped by course and post visibility. Related questions appear while composing a question. Semantic post search can be enabled with an embedding provider and PostgreSQL pgvector. See [post search](api/posts.md).

The staff-only Statistics tab reports daily questions, answers, and recorded post views for a selected period; average time from question creation to its first endorsed answer; and current student activity, including zero-activity students. Staff can download daily-activity and student-roster CSV reports. Statistics reflects recorded activity, including historical events supplied during import. See [statistics](api/statistics.md).

## Notifications and email

The notification bell lists course announcements, followed-post activity, mentions, owner-facing staff edit/merge/delete events, and watched Thread replies. Cards use current, access-checked excerpts where applicable and paginate with Load more. Deletion cards use generic text. In-app notifications and unread-message counts are separate concepts. See [notifications](api/notifications.md).

Per-course switches independently control activity, announcement, and daily-digest email. Authentication messages are sent by the API; queued activity, announcement, duplicate, invitation, and digest messages are delivered by the worker. The worker rechecks current eligibility before delivery and uses durable retries; cancellation is distinct from successful delivery. Production and local development use Resend's HTTPS API with a verified sender. The [daily digest reference](api/daily-course-email-digest.md) specifies its scheduling and privacy rules.

## Runtime architecture and deployment

The [core architecture diagram](../diagrams/architecture/architecture.svg) shows the approved deployment topology and data flows. A single OVHcloud VM runs the frontend/Caddy gateway, Express API, Hocuspocus collaboration process, and Node.js background worker as separate containers. Caddy terminates public HTTPS and routes same-origin API and collaboration WebSocket traffic to internal services. Express also owns the Threads WebSocket endpoint. The API and worker use managed Supabase PostgreSQL and private S3-compatible Supabase Storage; both reach Resend over HTTPS. The API sends authentication email directly, while the worker handles queued email. The collaboration process persists Yjs state and a readable projection in PostgreSQL.

Local development remains a reproducible Compose setup with PostgreSQL and SeaweedFS, while using Resend for real email. Production credentials stay server-side. Database migrations run as a deployment job using the API image. VM and external-service failures require operational monitoring, backups, and restore procedures.

PostgreSQL stores users, organizations, courses, memberships, content, notifications, sessions, collaboration state, idempotency records, and durable job/outbox state. Application authorization checks and database constraints enforce course access and relationship consistency. The API enforces access to files in a private Supabase Storage bucket using server-side S3 credentials. See the [database reference](database.md) and [security-sensitive API contracts](api/).

The worker claims jobs from PostgreSQL, retries transient failures, and performs scheduled digests and file cleanup. Post semantic search stores vectors in the same PostgreSQL database when configured.

## Reliability and verification

Public registration, verification, and session-bootstrap unsafe requests require an allowed origin; authenticated unsafe requests additionally require the session-bound CSRF token. Passwords are hashed; sessions use secure, HttpOnly cookies. Mutations validate authorization and use transactions, idempotency keys, and/or conditional versions where their API contracts specify them. Errors use the documented API envelope rather than exposing internal details. See [authentication](api/auth.md) and [OpenAPI](openapi.yaml).

The repository uses unit, API/database integration, browser, and targeted live-provider tests. UI changes are exercised in a real browser; mocked APIs are the default, and isolated full-stack checks cover changes that require them. Production validation additionally needs a public-domain smoke test of signup, post and file access, collaboration, and email delivery. Observability and retention are described in [observability](api/observability.md).
