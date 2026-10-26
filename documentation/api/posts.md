## Posts

**Implementation status:** JSON question, note, and poll creation, listing/search, retrieval, update, deletion, poll voting, announcements, and daily deduplicated post views are implemented. Active questions and notes can have files uploaded separately after saving; see the [OpenAPI attachment contract](../openapi.yaml) for current parent-scoped upload, download, and removal routes. Questions return `answered: true` when an active student or staff answer exists, and the `answered` list filter uses the same rule. The multipart post create/update shapes and attachment-processing/download-refresh fields below remain future targets and are not live; multipart create/update returns `422 validation_failed`. Deleted posts never appear in course lists; direct member GET by ID returns a tombstone. PATCH or DELETE of a tombstone returns `404 not_found`.

**Polls:** only TAs and instructors create polls (`403 permission_denied` for students). A poll has 2–10 fixed options of 1–200 characters, trimmed and distinct ignoring case. Omitted advanced fields preserve the basic poll: single-select, no deadline, live aggregates. Staff may instead configure `selectionMode: "single" | "multiple"`, `maxSelections` (one for single, 2 through the option count for multiple), future ISO `closesAt` with `Z` or a numeric offset, `releaseMode: "manual" | "automatic"`, and optional `explanation` (up to 10,000 characters). Multi-select creation requires an explicit manual or automatic release mode; omission is valid only for basic single-select live results. Members may replace a whole ballot with `{ "optionIds": ["..."] }`; legacy `{ "optionId": "..." }` remains valid for single-select. `DELETE` retracts before close. A deadline or staff close rejects all ballot changes with `409 poll_closed`; archive has the same effect. Staff may `POST /posts/{postId}/close`, `/reopen`, or `/release` with `If-Match`; each returns the updated post and advances its ETag. Release is irreversible, and reopening an expired poll clears its deadline. Poll projections include `selectionMode`, `maxSelections`, `closesAt`, `closed`, `releaseMode`, `resultsReleased`, and each option's `selected` flag. Option `voteCount`, aggregate `totalVotes` (distinct member ballots, not selections), and `explanation` are **absent**, not zero, for students before release; staff always see aggregates. Ballot identities are never exposed. Staff may GET `/posts/{postId}/poll-results.csv` (aggregate-only CSV) or POST `/posts/{postId}/clone` (new, open poll without ballots/deadline/release). A legacy live-results source clones to manual release so the new results start hidden; other stable settings and options copy. Votes do not change post `version` or activity time. Polls take no answers or followups. All member-specific poll responses use `Cache-Control: private, no-store`.

**Discussion locks:** Every active post list and detail projection includes `discussionLocked: boolean` (default `false`; always `false` for notes and announcements). Staff can conditionally lock or unlock a question or poll with `PUT /posts/{postId}/discussion-lock`; notes and announcements return `422 validation_failed`. A lock prevents new answers, followups, replies, poll votes and retractions, and answer/followup upvote changes; each returns `409 discussion_locked`. Existing content remains readable and editable/deletable according to ordinary permissions, and staff can change existing followup resolution markers. Toggling the lock advances the post version without changing `lastActivityAt`, so it does not reorder the recent-activity feed.

**Following and unread:** Every active post projection includes `following` and `unread` for the viewer. Members follow a post automatically when they create it, answer it, edit an answer on it, or post a followup or reply on it, unless they unfollowed it; see [Notifications](notifications.md). A post is `unread` when its last activity is later than both the viewer's last opening of it and their course read mark, or neither exists. Retrieving a post records it, and the caller's notifications for it, as read, so its own response reports `unread: false`.

**Private posts:** Any member may create a question or note with `private: true` while the course permits private posting; otherwise new private posts return `409 private_posting_disabled`. Only its author and the course's current TAs and instructors can read it. To every other member a private post, and its answers, followups, replies, attachments, upvotes, and live sessions, behaves exactly like a post that does not exist: requests return `404 not_found`, and it is left out of lists, search, related questions, notifications, and the daily digest (which omits private posts for every recipient). A deleted private post also returns `404 not_found` to its former author, because the tombstone keeps no author. The author or any TA or instructor may make a private post public with `PATCH` and `private: false`. That cannot be undone, and when staff do it the author receives a `post_published` notification. Announcements and polls cannot be private, and no post can be marked as a duplicate of a private post. List with `private=true` to see only the private posts you can read.

**Announcements:** TAs and instructors may create a note with `announcement: true`. It is pinned on creation, cannot be anonymous, and queues one email per other current course member with announcement emails enabled, which the job worker sends only while the announcement, the course, the membership, and that preference still stand. Students receive `403 permission_denied`; `announcement` on a question or poll returns `422 validation_failed`. Staff may later unpin an announcement. List with `announcement=true` to see only announcements.

New posts requesting `anonymous: true` return `409 anonymous_posting_disabled` if the course disallows anonymity. Existing anonymous or private posts remain available to authorized readers and editable after a policy change; changing a named existing post to anonymous returns the same `409` while anonymity is disabled. Matching successful idempotent creation retries still replay.

Author fields and anonymous-content filtering follow the shared [identity visibility policy](identity-visibility.md). Post bodies may [mention](notifications.md) course members; creating or editing a body that mentions more than 20 people returns `422 too_many_mentions`.

## Retained deleted posts

Post read responses can contain either an active post or a retained tombstone. `data.deleted` is the required discriminator. An active post sets `deleted` to `false`; the field inventories and examples below are illustrative, while the [OpenAPI post schemas](../openapi.yaml) define the complete current response shape. A tombstone sets `deleted` to `true` and contains only `id`, `courseId`, `type`, `deleted`, `createdAt`, `updatedAt`, and `version`. It omits the title, body, identity and anonymity projections, attachments, tags, poll state, duplicate state, endorsement state, and other content projections. The type remains `question`, `note`, or `poll` to preserve the original post kind. Create and ordinary update responses contain an active post; merge confirmation is the exception described below.

Confirmed duplicates are retained in storage but removed from ordinary lists, search, and Related questions. The old direct URL returns `303 See Other` to the canonical post for a current course member; it never returns the duplicate's content. Staff can retrieve a restricted duplicate-review list, read the retained source through a staff-only review endpoint, and unmerge it. Confirming a merge returns a minimal canonical reference rather than an active post.

#### Tombstone example

```json
{
  "id": "post_123",
  "courseId": "course_123",
  "type": "question",
  "deleted": true,
  "createdAt": "2026-09-20T13:00:00Z",
  "updatedAt": "2026-09-20T15:00:00Z",
  "version": 2
}
```

<a id="createPost"></a>

### **`POST /api/v1/courses/{courseId}/posts`**

Creates a post in a course.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member; creating a poll requires TA or instructor.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`Idempotency-Key` (optional, string, 1–255 characters): Reuses the original result for matching retries, including after a poll deadline passes; keys are retained for 24 hours. A new poll create with a past deadline is rejected.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

None.

#### Request body

##### `CreatePostRequest` (required)

Shape: exactly one of CreateQuestionPostRequest, CreateNotePostRequest, CreatePollPostRequest.

For the `private` field on question and note requests, see the [OpenAPI request schemas](../openapi.yaml).

###### `CreateQuestionPostRequest` fields

`type` (literal question, required): See the named shape.

`title` (string, required): Human-readable title.

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Hide the author from course members.

`tags` (list of string, optional): Post tags.

###### `CreateNotePostRequest` fields

`type` (literal note, required): See the named shape.

`title` (string, required): Human-readable title.

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Hide the author from course members.

`tags` (list of string, optional): Post tags.

`announcement` (boolean, optional; default false): TAs and instructors only. Posts the note as a pinned announcement emailed to members who enable announcement emails; cannot be combined with `anonymous`.

###### `CreatePollPostRequest` fields

`type` (literal poll, required): See the named shape.

`title` (string, required): Human-readable title.

`bodyMarkdown` (string, required): Markdown content.

`anonymous` (boolean, optional): Hide the author from course members.

`tags` (list of string, optional): Post tags.

`options` (list of PollOptionInput, required): Poll choices.

`options[].label` (string, required): Visible poll choice label.

`selectionMode` (enum: single, multiple, optional; default single): Ballot mode.

`maxSelections` (integer, optional; default 1 for single): Maximum choices; required as 2 through option count for multiple.

`closesAt` (ISO date-time, optional): Future deadline with a real calendar date and explicit `Z` or `±HH:MM` offset. Offset-free and nonexistent dates return `422 validation_failed`; accepted instants are normalized to UTC.

`releaseMode` (enum: manual, automatic): Required for multi-select; omit only for basic single-select live-results behavior.

`explanation` (string, optional): Staff-authored results explanation, visible to students only after release.

#### Multipart parts

`metadata` (`CreatePostRequest`, required, `application/json`): Future-only post multipart contract; not implemented. For current files, use the [parent-scoped upload routes](../openapi.yaml).

Shape: exactly one of CreateQuestionPostRequest, CreateNotePostRequest, CreatePollPostRequest.

##### `CreateQuestionPostRequest` fields

`metadata.type` (literal question, required): See the named shape.

`metadata.title` (string, required): Human-readable title.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Hide the author from course members.

`metadata.tags` (list of string, optional): Post tags.

##### `CreateNotePostRequest` fields

`metadata.type` (literal note, required): See the named shape.

`metadata.title` (string, required): Human-readable title.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Hide the author from course members.

`metadata.tags` (list of string, optional): Post tags.

##### `CreatePollPostRequest` fields

`metadata.type` (literal poll, required): See the named shape.

`metadata.title` (string, required): Human-readable title.

`metadata.bodyMarkdown` (string, required): Markdown content.

`metadata.anonymous` (boolean, optional): Hide the author from course members.

`metadata.tags` (list of string, optional): Post tags.

`metadata.options` (list of PollOptionInput, required): Poll choices.

`metadata.options[].label` (string, required): Visible poll choice label.

`attachments` (repeated file part, optional): Future-only post multipart contract; not implemented. For current files, use the [parent-scoped upload routes](../openapi.yaml).

**Success:** `201 Created`.

**Response media:** `application/json`.

#### Response headers

`Location` (string): Relative URL of the created resource or deletion status resource.

`ETag` (string): Opaque revision token representing the created resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Post details.

`data.id` (string, required): Opaque stable post identifier.

`data.courseId` (string, required): Opaque identifier of the course containing the post.

`data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the content fields below; `true` includes only `data.id`, `data.courseId`, `data.type`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.title` (string, required): Human-readable title.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.

`data.anonymous` (boolean, required): Whether the post was authored anonymously.

`data.tags` (list of strings, required): Course-defined post tags.

`data.attachments` (list of objects, required): Files attached to the post.

See the [OpenAPI Attachment schema](../openapi.yaml) for live file fields.

`data.pinned` (boolean, required): Whether staff pinned the post.

`data.announcement` (boolean, required): Whether staff posted this note as an announcement; always false for questions and polls.

`data.private` (boolean, required): Whether only the author and course staff can read the post.

`data.following` (boolean, required): Whether the viewer follows the post and is notified of its activity.

`data.unread` (boolean, required): Whether the post has activity since the viewer last opened it or marked the course read.

`data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.

`data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.

`data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.

`data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.

`data.unresolvedFollowups` (integer, required when `type` is `question`): Number of active followup discussions that are unresolved; see [Resolving discussions](answers.md).

###### `data.options` (list of objects, required when `type` is `poll`): Poll choices.

`data.options[].id` (string, required): Opaque stable poll-option identifier.

`data.options[].label` (string, required): Visible choice label.

`data.options[].voteCount` (integer, conditional): Selected-option count; omitted for students before release.

`data.options[].selected` (boolean, required): Whether the authenticated user selected the option.

`data.totalVotes` (integer, conditional): Distinct member ballots; omitted for students before release.

#### Example request

```bash
curl --request POST '/api/v1/courses/course_123/posts' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000' \
    --header 'Content-Type: application/json' \
    --data '{"type":"question","title":"Why is the sky blue?","bodyMarkdown":"How does scattering work?","anonymous":false,"tags":["physics"]}'
```

#### Example success response

```json
{
  "data": {
    "id": "post_123",
    "courseId": "course_123",
    "type": "question",
    "deleted": false,
    "title": "Why is the sky blue?",
    "bodyMarkdown": "How does scattering work?",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "tags": ["physics"],
    "attachments": [],
    "pinned": false,
    "duplicateOfPostId": null,
    "duplicateStatus": "none",
    "answered": false,
    "lastActivityAt": "2026-09-20T13:00:00Z",
    "createdAt": "2026-09-20T13:00:00Z",
    "updatedAt": "2026-09-20T13:00:00Z",
    "version": 1
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: Only staff may create polls.

##### `409 Conflict`

`idempotency_key_reused`: The idempotency key was already used with a different request body.

`course_archived`: The course is archived.

`anonymous_posting_disabled`: New anonymous posts are disabled for this course.

`private_posting_disabled`: New private posts are disabled for this course.

##### `413 Content Too Large`

`payload_too_large`: Future-only post multipart limit; current parent-scoped uploads use the [attachment contract](../openapi.yaml).

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: The post fields are invalid.

`private_announcement`: An announcement cannot be private.

`private_poll`: A poll cannot be private.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listCoursePosts"></a>

### **`GET /api/v1/courses/{courseId}/posts`**

Lists or searches the posts in a course. Ordinary search text combines English full-text matches with word-level fuzzy matches in titles and bodies. Fuzzy matching requires at least one query term of three or more searchable characters, ignores shorter terms and English stopwords, and requires every remaining term to match in either field. Queries with no eligible fuzzy terms use full-text matching and ranking alone. Under relevance sorting, exact full-text matches precede fuzzy-only matches within each pinned group; title similarity contributes more than body similarity within the groups. With deployment-configured embeddings and the optional pgvector schema, semantic-only matches follow both groups within each pinned group, ordered by cosine similarity without an initial cutoff. Semantic indexing and expansion apply only to questions and notes; polls retain the lexical/fuzzy path, and a poll-only query does not call the embedding provider. Private question and note candidates follow the same current author/staff visibility rules before ranking and pagination. Pinned results still precede unpinned results. A missing key, vector schema, working embedding provider, or unhealthy current-generation index leaves only the established full-text and fuzzy search path available. The current generation remains unhealthy until its initial bounded backfill finishes and current-revision work drains; pending current-generation catch-up work or a queued, running, or failed current-revision indexing job also keeps it unhealthy until successful revision-checked indexing. Post writes still succeed during enqueue and indexing failures. Quoted phrases, `OR`, and excluded-term queries retain their existing full-text-only meaning unless an explicit `semanticQuery` accompanies `q`. Confirmed duplicates are excluded from ordinary lists and searches, including Related questions, before ranking and pagination. Related questions keeps its existing `OR` expression in `q` and sends the draft text separately as `semanticQuery`; this adds semantic candidates only when configured, without changing the `OR` expression. Without q, results default to recent_activity. With q, results default to relevance. relevance is invalid when q is omitted.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`q` (string, optional; minimum length 1, maximum length 500): Trimmed non-empty search text; matching rules are described above. Omit to list without search.

`semanticQuery` (string, optional; minimum length 1, maximum length 500): A separate bounded natural-language query used for semantic candidates when embeddings are configured. Requires `q`. It does not change the boolean, phrase, or exclusion meaning of `q`; without semantic capability it is ignored and the lexical/fuzzy path remains available.

`type` (enum: question, note, poll, optional; values question, note, poll): Filter by post type.

`tag` (list of string, optional; at most 10 values, each 1–40 characters): Filter by one or more tags. Tags are trimmed and compared case-insensitively, and repeated values count once. More than 10 values return `400 invalid_request`.

`tagMatch` (enum: any, all, optional; values any, all): How repeated `tag` values combine. `any`, the default, returns posts carrying at least one requested tag; `all` returns only posts carrying every requested tag. With fewer than two distinct tags both values return the same results. Any other value returns `400 invalid_request`.

`authorId` (string, optional; minimum length 1, maximum length 255): Filter by author identifier. Staff may match all content; students may match nonanonymous content and their own anonymous content, except that a deleted author's content never matches a student `authorId` filter. Items whose identity is hidden from the viewer are removed before ranking, pagination, `hasMore`, and counts; no visible matches return an empty `200 OK` collection.

`createdAfter` (string, optional): Return posts created at or after this timestamp.

`createdBefore` (string, optional): Return posts created at or before this timestamp.

`answered` (boolean, optional): Filter question posts by answer presence.

`unresolvedFollowups` (literal true, optional): List only questions with at least one unresolved followup discussion. Any other value returns `400 invalid_request`.

`pinned` (boolean, optional): Filter by pinned state. Combine with `type` to list pinned posts of one type.

`announcement` (literal true, optional): List announcements only. Any other value returns `400 invalid_request`.

`private` (literal true, optional): List only the private posts the caller can read: their own for a student, every private post for staff. Any other value returns `400 invalid_request`.

`authorRole` (enum: instructor, ta, optional; values instructor, ta): Filter by the author's current role in the course. A post matches only while its author holds that role; posts by deleted accounts never match. For a student, anonymous posts other than the student's own are removed before ranking, pagination, `hasMore`, and counts, so the filter cannot reveal an anonymous author's role. Instructors and TAs match anonymous posts by that role.

`duplicateStatus` (enum: none, suggested, confirmed, optional; values none, suggested, confirmed): Filter by duplicate-review state. `confirmed` is staff-only and returns review entries containing only `id`, `courseId`, `type`, `title`, `duplicateStatus`, `duplicateOfPostId`, `canonicalTitle`, and `version`; no source body, author, or tags. Suggested duplicates remain visible in ordinary results.

`sort` (enum: relevance, newest, oldest, recent_activity, optional; values relevance, newest, oldest, recent_activity): Pinned posts appear before unpinned posts for every sort. Within each group, `newest` and `oldest` order by creation time, descending and ascending; `recent_activity` orders by the latest activity. Defaults to relevance when q is present and recent_activity otherwise.

`cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.

If semantic ranking becomes unhealthy between relevance pages, a semantic cursor returns `409 search_restart_required`. Restart the search without a cursor, retaining `q`, sort, and filters; the fresh response uses the established full-text and fuzzy path. Invalid or mismatched cursors still return `400 invalid_request`.

`limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`X-Feed-Snapshot` (string): A base64url-encoded course- and viewer-bound server timestamp from the list query, for the newly created post count. It contains the course and viewer IDs but no post IDs; clients must treat it as an opaque token, not a secret. The encoding is unsigned and is not authentication or authorization: a caller can supply a different timestamp, but every count still requires a current session and applies course membership and post visibility. The client must not derive a watermark from its clock or the first result page. The notice is best-effort: a creation transaction that began before the watermark but committed afterward can be missed; manually refreshing the feed still shows it.

`Cache-Control`: `private, no-store`.

#### Response body

##### `data` (list of objects, required): Every returned post contains the fields below.

`data[].id` (string, required): Opaque stable post identifier.

`data[].courseId` (string, required): Opaque identifier of the course containing the post.

`data[].type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.

`data[].deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the content fields below; `true` includes only `data[].id`, `data[].courseId`, `data[].type`, `data[].createdAt`, `data[].updatedAt`, and `data[].version`.

`data[].title` (string, required): Human-readable title.

`data[].bodyMarkdown` (string, required): Markdown content.

`data[].author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.

`data[].anonymous` (boolean, required): Whether the post was authored anonymously.

`data[].tags` (list of strings, required): Course-defined post tags.

`data[].attachments` (list of objects, required): Files attached to the post.

See the [OpenAPI Attachment schema](../openapi.yaml) for live file fields.

`data[].pinned` (boolean, required): Whether staff pinned the post.

`data[].announcement` (boolean, required): Whether staff posted this note as an announcement; always false for questions and polls.

`data[].private` (boolean, required): Whether only the author and course staff can read the post.

`data[].following` (boolean, required): Whether the viewer follows the post and is notified of its activity.

`data[].unread` (boolean, required): Whether the post has activity since the viewer last opened it or marked the course read.

`data[].duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.

`data[].duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.

`data[].lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.

`data[].createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.

`data[].updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.

`data[].version` (integer, required): Revision number used to construct the resource ETag.

`data[].answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.

`data[].unresolvedFollowups` (integer, required when `type` is `question`): Number of active followup discussions that are unresolved; see [Resolving discussions](answers.md).

###### `data[].options` (list of objects, required when `type` is `poll`): Poll choices.

`data[].options[].id` (string, required): Opaque stable poll-option identifier.

`data[].options[].label` (string, required): Visible choice label.

`data[].options[].voteCount` (integer, conditional): Selected-option count; omitted for students before release.

`data[].options[].selected` (boolean, required): Whether the authenticated user selected the option.

`data[].totalVotes` (integer, conditional): Distinct member ballots; omitted for students before release.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/posts' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "post_123",
      "courseId": "course_123",
      "type": "question",
      "deleted": false,
      "title": "Why is the sky blue?",
      "bodyMarkdown": "How does scattering work?",
      "author": {
        "userId": "user_123",
        "displayName": "Ada Lovelace",
        "anonymous": false,
        "deleted": false
      },
      "anonymous": false,
      "tags": ["physics"],
      "attachments": [],
      "pinned": false,
      "duplicateOfPostId": null,
      "duplicateStatus": "none",
      "answered": true,
      "lastActivityAt": "2026-09-20T14:30:00Z",
      "createdAt": "2026-09-20T13:00:00Z",
      "updatedAt": "2026-09-20T14:30:00Z",
      "version": 3
    }
  ],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: The query, filters, date range, sort, or pagination are invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`permission_denied`: The `duplicateStatus=confirmed` review filter is restricted to course TAs and instructors.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `409 Conflict`

`search_restart_required`: Semantic ranking became unavailable after the cursor was issued. Restart from page one without the cursor.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getPost"></a>

### **`GET /api/v1/posts/{postId}`**

Retrieves a post.

A confirmed duplicate is not returned as a post. After checking current membership in its course, this endpoint responds `303 See Other` with `Location: /api/v1/posts/{canonicalPostId}` and `Cache-Control: private, no-store`. Nonmembers receive `404 not_found` without a redirect.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK` for an active post or tombstone; `303 See Other` for a confirmed duplicate.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token for a later `If-Match` request.

`Cache-Control` (string): `private, no-store`, because `following` and `unread` are per viewer and change without a new revision.

`Location` (string, on `303`): Same-course canonical post URL.

`Cache-Control` (string, on `303`): `private, no-store`.

#### Response body

##### `data` (object, required): Post details.

`data.id` (string, required): Opaque stable post identifier.

`data.courseId` (string, required): Opaque identifier of the course containing the post.

`data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the content fields below; `true` includes only `data.id`, `data.courseId`, `data.type`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.title` (string, required): Human-readable title.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.

`data.anonymous` (boolean, required): Whether the post was authored anonymously.

`data.tags` (list of strings, required): Course-defined post tags.

`data.attachments` (list of objects, required): Files attached to the post.

See the [OpenAPI Attachment schema](../openapi.yaml) for live file fields.

`data.pinned` (boolean, required): Whether staff pinned the post.

`data.announcement` (boolean, required): Whether staff posted this note as an announcement; always false for questions and polls.

`data.private` (boolean, required): Whether only the author and course staff can read the post.

`data.following` (boolean, required): Whether the viewer follows the post and is notified of its activity.

`data.unread` (boolean, required): Whether the post has activity since the viewer last opened it or marked the course read.

`data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.

`data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.

`data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.

`data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.

`data.unresolvedFollowups` (integer, required when `type` is `question`): Number of active followup discussions that are unresolved; see [Resolving discussions](answers.md).

###### `data.options` (list of objects, required when `type` is `poll`): Poll choices.

`data.options[].id` (string, required): Opaque stable poll-option identifier.

`data.options[].label` (string, required): Visible choice label.

`data.options[].voteCount` (integer, conditional): Selected-option count; omitted for students before release.

`data.options[].selected` (boolean, required): Whether the authenticated user selected the option.

`data.totalVotes` (integer, conditional): Distinct member ballots; omitted for students before release.

#### Example request

```bash
curl --request GET '/api/v1/posts/post_123' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "id": "post_123",
    "courseId": "course_123",
    "type": "question",
    "deleted": false,
    "title": "Why is the sky blue?",
    "bodyMarkdown": "How does scattering work?",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "tags": ["physics"],
    "attachments": [],
    "pinned": false,
    "duplicateOfPostId": null,
    "duplicateStatus": "none",
    "answered": true,
    "lastActivityAt": "2026-09-20T14:30:00Z",
    "createdAt": "2026-09-20T13:00:00Z",
    "updatedAt": "2026-09-20T14:30:00Z",
    "version": 3
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The post is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getDuplicateReview"></a>

### **`GET /api/v1/posts/{postId}/duplicate-review`**

Retrieves the retained full post for staff review of an active, confirmed duplicate. This endpoint does not redirect; the ordinary `GET /api/v1/posts/{postId}` still returns `303` to the canonical post. The response uses the existing active post projection, including title, body, tags, author as visible to staff, `duplicateStatus: confirmed`, `duplicateOfPostId`, and version. The staff review list remains summary-only.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Current course TA or instructor. Current student members receive `403 permission_denied`. Nonmembers, absent posts, deleted posts, and posts not confirmed as duplicates receive `404 not_found`.

**Request media:** None. No request body or query parameters.

**Success:** `200 OK` with `{ "data": <active post> }`.

**Response headers:** `ETag` carries the current post revision for conditional unmerge; `Cache-Control: private, no-store` prevents retained source content from being cached.

**Errors:** `401 authentication_required`, `403 permission_denied`, `404 not_found`, `500 internal_error`, `503 service_unavailable`.

---

<a id="updatePost"></a>

### **`PATCH /api/v1/posts/{postId}`**

Updates a post. Members may suggest duplicates. Staff may confirm duplicates and change pinned. At least one metadata field or attachment addition is required.

Staff confirmation retains the source text in storage but hides it from readers. The `200` confirmation response contains only `data.id`, `data.courseId`, `data.duplicateStatus: confirmed`, `data.duplicateOfPostId`, and `data.version`. Staff unmerge by setting `duplicateStatus: none` and `duplicateOfPostId: null` with the current ETag; the retained source becomes visible again. While merged, all other source edits and deletion fail with `409 post_merged`. A canonical post with confirmed inbound references cannot be deleted or merged until those sources are unmerged (`409 canonical_has_duplicates`). Canonical targets must be active, same-course posts that are not themselves confirmed duplicates; a suggested duplicate is a valid target.

When a TA or instructor confirms a **question** duplicate, the same transaction queues an email to its author. The email subject is `Your post has been marked as a duplicate`; for an active confirming staff account, the plain-text body says `Your question "<question>" was marked as a duplicate by <staff name> (<instructor or TA>).` If that staff account is deleted before delivery, it instead says `Your question "<question>" was marked as a duplicate by a TA.` or `Your question "<question>" was marked as a duplicate by an instructor.`, as appropriate. The job does not retain the staff display name, and both forms include an absolute link to the canonical post. SMTP delivery occurs asynchronously with retries, so mail failure does not change the PATCH response or undo the merge. A suggestion, note confirmation, failed update, and unmerge do not queue this email. Before delivery, the worker cancels a stale notification if the question is no longer merged to that canonical post or the author no longer has active course access. SMTP acceptance followed by a worker crash may rarely result in a repeated email.

Every successful PATCH update, including pin, unpin, merge, and unmerge, advances `lastActivityAt`. An unpinned post returns to its normal sort position; in `recent_activity` that position reflects the update time. Discussion-lock changes use a [separate endpoint](#discussionLock) and preserve `lastActivityAt`.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Author or staff for ordinary content edits; any course member may suggest a duplicate; only staff may confirm or clear duplicate review and change pinning. A nonmember receives `404 not_found`.

**Request media:** `application/json`, `multipart/form-data`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

##### `UpdatePostRequest` (required)

`title` (string, optional): Human-readable title.

`bodyMarkdown` (string, optional): Markdown content.

`anonymous` (boolean, optional): Whether to hide the author.

`tags` (list of string, optional): Replacement tags.

`pinned` (boolean, optional): Staff-controlled pinned state.

`private` (boolean, optional): `false` makes a private post public; the author or staff only, and it cannot be undone. `true` on a public post returns `422 post_already_public`, and is ignored on a private post.

`duplicateOfPostId` (string or null, optional): Original post ID, or null to clear the relationship.

`duplicateStatus` (enum: none, suggested, confirmed, optional): Duplicate-review state.

`removeAttachmentIds` (list of string, optional): Existing attachments to remove.

#### Multipart parts

`metadata` (`UpdatePostRequest`, optional, `application/json`): Send metadata as application/json when changing post fields or removing attachments. It is not required when the request adds one or more attachments.

`metadata.title` (string, optional): Human-readable title.

`metadata.bodyMarkdown` (string, optional): Markdown content.

`metadata.anonymous` (boolean, optional): Whether to hide the author.

`metadata.tags` (list of string, optional): Replacement tags.

`metadata.pinned` (boolean, optional): Staff-controlled pinned state.

`metadata.duplicateOfPostId` (string or null, optional): Original post ID, or null to clear the relationship.

`metadata.duplicateStatus` (enum: none, suggested, confirmed, optional): Duplicate-review state.

`metadata.removeAttachmentIds` (list of string, optional): Existing attachments to remove.

`attachments` (repeated file part, optional): Future-only post multipart contract; not implemented. For current files, use the [parent-scoped upload routes](../openapi.yaml).

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`ETag` (string): Opaque revision token representing the returned resource state; return it unchanged in a later `If-Match` request.

#### Response body

##### `data` (object, required): Post details.

`data.id` (string, required): Opaque stable post identifier.

`data.courseId` (string, required): Opaque identifier of the course containing the post.

`data.type` (enum: question, note, poll, required): Post type and discriminator for the conditional fields below.

`data.deleted` (boolean, required): Required active-or-tombstone discriminator. `false` includes the content fields below; `true` includes only `data.id`, `data.courseId`, `data.type`, `data.createdAt`, `data.updatedAt`, and `data.version`.

`data.title` (string, required): Human-readable title.

`data.bodyMarkdown` (string, required): Markdown content.

`data.author` (object, required): Author identity visible to the authenticated viewer under the shared identity visibility policy.

`data.anonymous` (boolean, required): Whether the post was authored anonymously.

`data.tags` (list of strings, required): Course-defined post tags.

`data.attachments` (list of objects, required): Files attached to the post.

See the [OpenAPI Attachment schema](../openapi.yaml) for live file fields.

`data.pinned` (boolean, required): Whether staff pinned the post.

`data.announcement` (boolean, required): Whether staff posted this note as an announcement; always false for questions and polls.

`data.private` (boolean, required): Whether only the author and course staff can read the post.

`data.following` (boolean, required): Whether the viewer follows the post and is notified of its activity.

`data.unread` (boolean, required): Whether the post has activity since the viewer last opened it or marked the course read.

`data.duplicateOfPostId` (string or null, required): Canonical post identifier for a suggested or confirmed duplicate; otherwise `null`.

`data.duplicateStatus` (enum: none, suggested, confirmed, required): Duplicate-review state.

`data.lastActivityAt` (string, required): UTC timestamp of the post's latest activity in ISO 8601 date-time format.

`data.createdAt` (string, required): UTC creation timestamp in ISO 8601 date-time format.

`data.updatedAt` (string, required): UTC timestamp of the latest post update in ISO 8601 date-time format.

`data.version` (integer, required): Revision number used to construct the resource ETag.

`data.answered` (boolean, required when `type` is `question`): Whether a student or staff answer exists.

`data.unresolvedFollowups` (integer, required when `type` is `question`): Number of active followup discussions that are unresolved; see [Resolving discussions](answers.md).

###### `data.options` (list of objects, required when `type` is `poll`): Poll choices.

`data.options[].id` (string, required): Opaque stable poll-option identifier.

`data.options[].label` (string, required): Visible choice label.

`data.options[].voteCount` (integer, conditional): Selected-option count; omitted for students before release.

`data.options[].selected` (boolean, required): Whether the authenticated user selected the option.

`data.totalVotes` (integer, conditional): Distinct member ballots; omitted for students before release.

#### Example request

```bash
curl --request PATCH '/api/v1/posts/post_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"' \
    --header 'Content-Type: application/json' \
    --data '{"title":"Why does the daytime sky look blue?","removeAttachmentIds":["attachment_old"]}'
```

#### Example success response

```json
{
  "data": {
    "id": "post_123",
    "courseId": "course_123",
    "type": "question",
    "deleted": false,
    "title": "Why does the daytime sky look blue?",
    "bodyMarkdown": "How does scattering work?",
    "author": {
      "userId": "user_123",
      "displayName": "Ada Lovelace",
      "anonymous": false,
      "deleted": false
    },
    "anonymous": false,
    "tags": ["physics"],
    "attachments": [],
    "pinned": false,
    "duplicateOfPostId": null,
    "duplicateStatus": "none",
    "answered": true,
    "lastActivityAt": "2026-09-20T14:30:00Z",
    "createdAt": "2026-09-20T13:00:00Z",
    "updatedAt": "2026-09-20T14:40:00Z",
    "version": 4
  }
}
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: The caller cannot change one or more fields.

##### `404 Not Found`

`not_found`: The post does not exist, is outside the caller's current course memberships, or is already deleted.

##### `409 Conflict`

`course_archived`: The course is archived.

`anonymous_posting_disabled`: A named post cannot become anonymous while the course disallows it.

`post_merged`: The confirmed source must be unmerged before it can be edited.

`canonical_has_duplicates`: Confirmed sources must be unmerged before their canonical post can be merged.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `413 Content Too Large`

`payload_too_large`: An attachment exceeds a limit.

##### `415 Unsupported Media Type`

`unsupported_media_type`: An attachment type is unsupported.

##### `422 Unprocessable Content`

`validation_failed`: No valid editable field was supplied.

`post_already_public`: A public post cannot be made private.

`duplicate_target_private`: A post cannot be marked as a duplicate of a private post.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="discussionLock"></a>

### **`PUT /api/v1/posts/{postId}/discussion-lock`**

Current course TAs and instructors set an individual question's or poll's discussion lock with JSON `{ "locked": true }` or `{ "locked": false }`. This route requires the session cookie, valid Origin and CSRF token, `Content-Type: application/json`, and `If-Match: "v{version}"`. It returns `200` with `{ "data": Post }` and the current ETag. A state change increments the post version and update time; repeating the current state retains both version and last-activity time. Lock changes never move a post in the recent-activity feed.

The request body must contain only the boolean `locked` field. Invalid shapes, unknown fields, non-boolean values, and attempts to lock or unlock notes (including announcements) return `422 validation_failed`; rejected note requests leave version and activity unchanged. Missing and stale `If-Match` return `428 precondition_required` and `412 version_conflict`; students receive `403 permission_denied`, while nonmembers, deleted posts, and confirmed duplicate sources return `404 not_found`. Archived courses return `409 course_archived`.

---

<a id="deletePost"></a>

### **`DELETE /api/v1/posts/{postId}`**

Deletes a post. A bodyless, authorless tombstone is retained when nested content requires it. Confirmed sources cannot be deleted until unmerged, and canonicals with confirmed inbound references cannot be deleted until those references are unmerged.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Author or staff.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`If-Match` (required, string): Supplies the ETag from the latest retrieval.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/posts/post_123' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'If-Match: "v3"'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

`permission_denied`: Deletion is forbidden.

##### `404 Not Found`

`not_found`: The post does not exist, is outside the caller's current course memberships, or is already deleted.

##### `409 Conflict`

`course_archived`: The course is archived.

`post_merged`: The confirmed source must be unmerged before it can be deleted.

`canonical_has_duplicates`: Confirmed sources must be unmerged before their canonical post can be deleted.

##### `412 Precondition Failed`

`version_conflict`: The supplied ETag is stale.

##### `428 Precondition Required`

`precondition_required`: If-Match is required.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

### Poll lifecycle, export, and clone

`POST /api/v1/posts/{postId}/close`, `/reopen`, and `/release` require a current TA or instructor, session cookie, allowed Origin, CSRF token, and current `If-Match: "vN"`. They return `200 {"data": <viewer-aware poll post>}` with the next `ETag` and `Cache-Control: private, no-store`. Missing/stale ETags return `428 precondition_required`/`412 version_conflict`; students receive `403 permission_denied`; missing, deleted, hidden, or unrelated polls return `404 not_found`; a non-poll returns `422 not_a_poll`; an inactive course or already reached close/open state returns `409`. Closing an automatic-release poll exposes aggregates; reopening never hides them and removes an elapsed deadline. Manual release is irreversible.

`GET /api/v1/posts/{postId}/poll-results.csv` requires staff membership and returns `200 text/csv; charset=utf-8`, an attachment filename, and `Cache-Control: private, no-store`. Its columns are `option,count,ballots`; counts are selections, ballots are distinct members. Labels are CSV-quoted and spreadsheet-formula escaped. No voter IDs, names, or per-ballot rows are included. Students receive `403 permission_denied`.

`POST /api/v1/posts/{postId}/clone` requires staff membership and the usual unsafe-request CSRF protections. It returns `201 {"data": <new poll>}`, `Location`, and `ETag`. Title, body, option labels, selection mode, maximum, explanation, and nonlegacy release mode copy; ballots, deadline, closed state, and release state reset. A legacy live-results source becomes manual-release on its clone. Students receive `403 permission_denied`; inactive courses return `409 course_archived`.

<a id="putPostVote"></a>

### **`PUT /api/v1/posts/{postId}/vote`**

Casts or replaces the authenticated user’s entire ballot on an open poll. Use legacy `optionId` for single-select or `optionIds` for an array of distinct selections (one through the configured maximum).

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** `application/json`

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required): Selects one documented request media type.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

##### `VoteRequest` (required)

Exactly one of `optionId` (single-select legacy ballot) or `optionIds` (array of one through `maxSelections` distinct option IDs) is required; see the [VoteRequest schema](../openapi.yaml).

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None specific to this operation.

#### Response body

##### `data` (object, required): The caller's selected choices and viewer-visible poll results.

`data.postId` (string, required): Opaque stable identifier.

`data.options` (list of objects, required): Updated poll choices.

`data.totalVotes` (integer, conditional): Distinct member ballots, omitted for unreleased student results.

#### Example request

```bash
curl --request PUT '/api/v1/posts/post_123/vote' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Content-Type: application/json' \
    --data '{"optionId":"option_1"}'
```

#### Example success response

```json
{
  "data": {
    "postId": "post_123",
    "options": [
      {
        "id": "option_1",
        "label": "Blue",
        "voteCount": 12,
        "selected": true
      },
      {
        "id": "option_2",
        "label": "Red",
        "voteCount": 4,
        "selected": false
      }
    ],
    "totalVotes": 16
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `409 Conflict`

`poll_closed`: The poll or course is closed.

##### `422 Unprocessable Content`

`not_a_poll`: The post is not a poll.

`poll_option_invalid`: The option does not belong to this poll.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="deletePostVote"></a>

### **`DELETE /api/v1/posts/{postId}/vote`**

Retracts the authenticated user’s ballot from an open, unlocked poll. Returns 204 even when the caller has no ballot; a closed or locked poll rejects the change.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

#### Multipart parts

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response headers

None specific to this operation.

#### Response body

None.

#### Example request

```bash
curl --request DELETE '/api/v1/posts/post_123/vote' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `409 Conflict`

`poll_closed`: The poll or course is closed.

##### `422 Unprocessable Content`

`not_a_poll`: The post is not a poll.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="followPost"></a>

### **`PUT /api/v1/posts/{postId}/follow`**

Follows a post the caller can read, so its activity notifies them.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member who can read the post.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response body

##### `data` (object, required): The caller's follow state.

`data.following` (boolean, required): Whether the caller now follows the post.

#### Example request

```bash
curl --request PUT '/api/v1/posts/post_123/follow' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```json
{
  "data": {
    "following": true
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The post does not exist, is deleted or a confirmed duplicate, or is not visible to the caller.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="unfollowPost"></a>

### **`DELETE /api/v1/posts/{postId}/follow`**

Stops notifications for the post. The unfollow persists: later activity by the caller does not follow the post again automatically.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member who can read the post.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`postId` (string, required, 1–255 characters): Identifies the post resource.

#### Query parameters

None.

#### Request body

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response body

##### `data` (object, required): The caller's follow state.

`data.following` (boolean, required): Whether the caller now follows the post.

#### Example request

```bash
curl --request DELETE '/api/v1/posts/post_123/follow' \
    --header 'Accept: application/json' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```json
{
  "data": {
    "following": false
  }
}
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The post does not exist, is deleted or a confirmed duplicate, or is not visible to the caller.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="markCourseRead"></a>

### **`POST /api/v1/courses/{courseId}/read-marks`**

Marks every post in the course read for the caller as of now. Later activity makes a post unread again.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

None.

#### Request body

None.

**Success:** `204 No Content`.

**Response media:** None.

#### Response body

None.

#### Example request

```bash
curl --request POST '/api/v1/courses/course_123/read-marks' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token'
```

#### Example success response

```http
204 No Content
```

#### Errors

##### `403 Forbidden`

`csrf_validation_failed`: The request origin or CSRF token is missing, invalid, or does not match the session.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course does not exist or the caller is not a member.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

### New-post notice endpoint

**`GET /api/v1/courses/{courseId}/posts/new-count?snapshot=<token>`** returns `{ "data": { "count": number } }` and `Cache-Control: private, no-store`. It accepts the same list filters except `cursor` and `duplicateStatus=confirmed`, and counts active, unmerged, currently readable posts created after the supplied watermark and matching the supplied filters. Edits and new activity on old posts do not count. The unsigned token includes course and viewer IDs, which are checked against the request; missing, malformed, or cross-course/viewer tokens return `400 invalid_request`. Its encoding does not prove issuance, so the timestamp is not a security boundary. A nonmember receives `404 not_found`; an unauthenticated caller receives `401`. This check never marks posts read or moves an existing feed. The count is best-effort for a creation transaction that began before the original list snapshot but committed afterward.
