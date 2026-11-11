# ChalkTalk

ChalkTalk is a course discussion platform for students, teaching assistants, and instructors.

It is designed to make large course forums easier to search, organize, and maintain throughout a semester. Course post search combines full-text and fuzzy matching to help students find existing answers, including when a word is misspelled. Deployments can optionally add semantic matching to surface related questions and notes with different wording.

Students can ask questions, participate in threaded discussions, contribute to shared answers, search previous posts, view course resources, vote in polls, and optionally post anonymously.

In a course's Resources tab, use **Search resources** just below the introduction to search by title or by words inside uploaded documents and images. Content matches become available after background text extraction; links match by title. While searching, creation tools are hidden. Select **Clear resource search** to return focus to the search field and restore the catalog and creation tools, with the sort, open edits, and unsaved form values preserved. TAs and instructors see indicators when a file's contents are pending or unavailable for search; the file can still be downloaded. See the [resource search reference](documentation/api/resources.md#searchCourseResources) for supported formats and search rules.

A passive new-post count shows how many matching posts arrived since the feed loaded without interrupting the current post or an unsent draft. A browser refresh loads the latest posts.

Teaching assistants and instructors can collaboratively maintain staff answers, endorse correct responses, moderate discussions, organize posts with tags and managed folders, manage course resources, and identify unanswered questions. Each post can have one optional folder, distinct from tags and course-resource sections; members can file their own posts, while staff manage folder names and can organize any post. Readers can select multiple folders in the feed sidebar, clear all selections to see posts with no folder, or explicitly choose All posts.

Shared answer edits save explicitly with version checks so one person's changes cannot silently overwrite another's.

Instructors can turn off new anonymous or private contributions and pause follow-up resolution in a course's settings. Existing contributions and resolution markers remain visible to their authorized readers.

In course settings, an instructor must confirm the named member before removing them or the named course before deleting it. Cancel or Escape leaves it unchanged; if the course or membership changed meanwhile, review the refreshed details and confirm again before retrying.

Staff can pause new discussion and voting on an individual question or poll without hiding its existing content.

Core features include:

- course-based discussion forums,
- student, TA, and instructor roles,
- full-text and fuzzy post search with optional semantic matching,
- similar-question suggestions,
- collaborative student and staff answers,
- threaded follow-up discussions,
- [public course Threads](documentation/api/channels.md) for member conversations,
- endorsed answers,
- anonymous posting,
- private, autosaved drafts for unfinished new posts,
- Markdown and LaTeX support,
- image and document uploads,
- private live code and whiteboard sessions from each course's Collaboration tab,
- course resources, including an in-app PDF viewer with page-anchored questions,
- polls,
- notifications,
- optional per-course daily email summaries of qualifying previous-day activity,
- moderation tools,
- course statistics that include imported Piazza history in course-to-date totals.

ChalkTalk's goal is to turn a semester's discussion history into a searchable and reusable course knowledge base rather than a collection of disconnected posts.

To manage your account, select your name in the signed-in top bar. Account settings lets you change your display name or password, manage each course's activity, announcement, and daily-digest emails, or delete your account after confirming with your current password. You can also change email choices in each course's settings. Deletion signs you out and leaves past contributions with your name removed. If you are a course's final instructor, assign another instructor before deleting your account.

When starting a post, your one private course draft is automatically restored. Text and post settings autosave across sessions; queued files are not saved with the draft and must be reselected after a reload. See the [post drafts reference](documentation/api/posts.md#private-new-post-drafts) for save, conflict, and archived-course behavior.

To delete a post you can read, open its detail view and select **Delete post**. The control is available to its author and current course TAs or instructors while the course is active, and asks for confirmation before deleting.

## Team

- **Nicholas Smirnov** — authentication, authorization, security, account management, permissions
- **Khai Hern Low** — database design, semantic search, indexing, concurrency
- **Jackie Lee** — frontend, UI components, resources, notifications, responsive design
- **Darren Hamilton** — project management, testing coordination, documentation, integration

## Project map and documentation

The React/Vite client (`apps/web`) is served through Caddy, which proxies to the Express API (`apps/api`) and collaboration service. PostgreSQL stores application data and background jobs; a separate worker sends mail and processes queued work. The API handles Threads WebSockets; a collaboration server handles live-session WebSockets. Uploaded files use S3-compatible storage (SeaweedFS locally). See the [architecture diagram](diagrams/architecture/architecture.svg), [design](documentation/design.md), [database reference](documentation/database.md), and [API reference](documentation/openapi.yaml). The [`documentation/api/`](documentation/api/) directory explains individual API areas.

For configuration, startup, troubleshooting, and Piazza import, see the [local development guide](deployment/local/README.md). The [production deployment guide](deployment/production/README.md) covers the single-VM stack with Supabase PostgreSQL and Storage, Resend HTTPS, and private Grafana, Prometheus, Loki, and Alloy observability.
