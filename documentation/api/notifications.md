## Notifications

Members are notified of activity on posts they follow and of announcements in their courses. A member follows a post automatically when they create it, create or edit an answer on it, or post a followup or reply on it, and can follow or unfollow any readable post; see [Follow post](posts.md#followPost). An explicit unfollow persists.

These events create one notification for each other follower who is a current course member with an account that is not deleted:

- `answer_created` and `answer_edited`: a student or staff answer is created or edited;
- `answer_endorsed`: staff endorse a student answer;
- `followup_created`: a followup is posted;
- `reply_created`: a reply is posted to a followup.

When a TA or instructor makes someone's private post public, its author receives a `post_published` notification.

A post author receives an in-app `post_staff_edited` notification if another TA or instructor actually changes the title or Markdown body. A metadata-only or no-op edit does not notify. A confirmed question merge creates `post_merged` instead of a simultaneous edit notice; it links to the canonical post and is hidden if the merge is undone or the target becomes unavailable. Staff deletion of someone else's post creates `post_staff_deleted`, with generic wording and a course-feed destination. It retains no deleted title/body. These three kinds do not create email jobs, and staff never receive a notice for their own action.

**Mentions:** A Markdown body (post, answer, followup, or reply) mentions a member with `[@Display text](mention:<userId>)`, and `@staff` mentions every current TA and instructor. Mentions inside code spans and code blocks are ignored. Creating content sends a `mentioned` notification to each mentioned user who is a current member with an account that is not deleted, can read the post, and is not the author; editing sends one only to people the previous body did not mention. Someone who is both mentioned and a follower receives only the `mentioned` notification for that write. A body that mentions more than 20 individual users returns `422 too_many_mentions` (`@staff` counts as one). Mention notifications follow the anonymity and email rules below.

An announcement creates an `announcement` notification for every other current course member. The actor is never notified of their own activity.

Ordinary notifications are listed only while the caller is still a member of the course who can read the active, unmerged post. A merge notice instead requires an unchanged confirmed merge and a readable, active canonical post. A deletion notice remains visible to its recipient while they are a course member, despite the scrubbed source post. Followers who can no longer read a private post, for example a TA who became a student, are not notified. List and unread count use the same visibility rules. Opening a post with [Get post](posts.md) marks the caller's notifications for it as read.

**Email:** Members who enable `activityEmails` in their [per-course email preferences](courses.md#courseEmailPreferences) are emailed about existing activity/mention notifications, not the new staff edit/merge/delete in-app kinds or announcements. `announcementEmails` and `digestEmails` independently control those course emails. The worker sends only while the notification is unread, the setting is still on, the recipient is still a member, and the post is still visible. Follower-activity mail also requires the recipient to still follow the post; a direct mention remains deliverable after unfollowing. An anonymous actor appears as "Someone".

For newly created answers, root followups, and nested replies, the email includes up to three nonempty lines of the current response text (at most 360 characters) and a link to that exact response. A recipient who can no longer read the response, or whose response was deleted before delivery, receives no excerpt or email. The browser reveals and focuses a linked answer or followup, including an off-page nested reply. An unavailable linked response does not reveal its content. Older queued jobs without a response reference continue to use the post link.

<a id="listNotifications"></a>

### **`GET /api/v1/users/me/notifications`**

Lists the caller's notifications newest first across courses.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

None.

#### Query parameters

`limit` (integer, optional, 1–100, default 25): Page size.

`cursor` (string, optional): Opaque cursor returned by the previous page with the same filter.

`unread` (literal `true`, optional): Lists only unread notifications.

Any other parameter or value returns `400 invalid_request`.

#### Request body

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response body

##### `data` (list of objects, required): Notifications, newest first.

`data[].id` (string, required): Opaque stable identifier.

`data[].kind` (enum: answer_created, answer_edited, answer_endorsed, followup_created, reply_created, announcement, post_published, mentioned, post_staff_edited, post_merged, post_staff_deleted, required): What happened.

`data[].courseId` (string, required): Course of the post.

`data[].courseName` (string, required): Current course name.

`data[].postId` (string, required): Post the activity happened on.

`data[].postTitle` (string or null, required): Current post title; `null` for deletion notices.

`data[].preview` (string or null, required): Up to three nonblank lines and 360 characters of the **current** referenced answer/followup text as plain text, without Markdown formatting or link targets; otherwise `null`. No response text is stored in the notification row.

`data[].responseUnavailable` (boolean, required): True when a referenced response was later deleted or removed; its old text is never returned.

`data[].addressedToOwner` (boolean, required): True when a new answer or root followup addresses the post author, or a nested reply addresses its direct parent followup author. The question author is not the owner of another member's followup. Existing follow/unfollow rules still determine whether an event is created.

`data[].destination` (object, required): `{ "kind": "course", "courseId": … }` for a deletion notice; `{ "kind": "post", "postId": … }` for a post or canonical merge target; or `{ "kind": "answer" | "followup", "postId": …, "responseId": … }` for an available referenced response. Clients build same-origin navigation from these typed IDs; no arbitrary URL or HTML is returned.

`data[].actor` (object or null, required): `{ "displayName": … }` for who acted. A student sees `{ "displayName": "Anonymous" }` for an anonymous actor; TAs and instructors see the name. `null` when the actor's account is deleted.

`data[].createdAt` (string, required): UTC timestamp in ISO 8601 date-time format.

`data[].readAt` (string or null, required): When the caller read it, or `null` while unread.

##### `page` (object, required)

`page.nextCursor` (string or null, required): Cursor for the next page, or `null` on the last page.

`page.hasMore` (boolean, required): Whether another page exists.

#### Example request

```bash
curl '/api/v1/users/me/notifications?unread=true' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "id": "0192f7a4-58ae-7009-9f43-d1ba75831d5f",
      "kind": "answer_created",
      "courseId": "course_123",
      "courseName": "CS 101",
      "postId": "post_123",
      "postTitle": "Why does my loop never stop?",
      "preview": "The condition never becomes false.",
      "responseUnavailable": false,
      "addressedToOwner": true,
      "destination": {
        "kind": "answer",
        "postId": "post_123",
        "responseId": "answer_123"
      },
      "actor": { "displayName": "Grace Hopper" },
      "createdAt": "2026-09-20T14:30:00Z",
      "readAt": null
    }
  ],
  "page": { "nextCursor": null, "hasMore": false }
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: A query parameter or the cursor is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="countUnreadNotifications"></a>

### **`GET /api/v1/users/me/notifications/unread-count`**

Counts the caller's unread notifications under the same visibility rules as the list.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response body

##### `data` (object, required)

`data.count` (integer, required): Unread notifications the caller can still see.

#### Example success response

```json
{ "data": { "count": 2 } }
```

#### Errors

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="markNotificationsRead"></a>

### **`POST /api/v1/users/me/notifications/read`**

Marks the given notifications, or all of the caller's notifications when the body is empty, as read. Ids belonging to other users are ignored.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Signed-in user.

**Request media:** `application/json`, or no body.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

`Origin` (required, string): Browser origin, which must exactly match a deployment-configured HTTPS frontend origin.

`Content-Type` (required when a body is sent): Selects one documented request media type.

`X-CSRF-Token` (required, string): Stable opaque token bound to the current session.

#### Request body

##### `MarkNotificationsReadRequest` (optional)

`ids` (list of strings, required when a body is sent, 1–100 UUIDs): Notifications to mark read. Omit the body, or send `{}`, to mark all.

**Success:** `204 No Content`.

**Response media:** None.

#### Example request

```bash
curl --request POST '/api/v1/users/me/notifications/read' \
    --header 'Origin: https://app.example.edu' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session' \
    --header 'X-CSRF-Token: opaque_csrf_token' \
    --header 'Content-Type: application/json' \
    --data '{"ids":["0192f7a4-58ae-7009-9f43-d1ba75831d5f"]}'
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

##### `422 Unprocessable Content`

`validation_failed`: The ids are missing, more than 100, or not UUIDs, or the body has other fields.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listMentionSuggestions"></a>

### **`GET /api/v1/courses/{courseId}/mention-suggestions`**

Suggests course members to mention, for the editor's `@` picker.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Course member.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`q` (string, optional, 0–50 characters): Text the display name must contain, ignoring case. Names that start with it come first.

`postId` (string, optional): Suggest only members who can read this post, which the caller must be able to read.

Any other parameter returns `400 invalid_request`.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response body

##### `data` (list of objects, required): At most 8 current members, excluding the caller and deleted accounts.

`data[].userId` (string, required): Opaque stable identifier.

`data[].displayName` (string, required): Visible account name.

`data[].role` (enum: student, ta, instructor, required): The member's course role.

#### Example request

```bash
curl '/api/v1/courses/course_123/mention-suggestions?q=gra' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    { "userId": "user_456", "displayName": "Grace Hopper", "role": "ta" }
  ]
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: The query is too long or has unknown parameters.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `404 Not Found`

`not_found`: The course does not exist or the caller is not a member, or the post is not readable.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.
