## Statistics

<a id="getCourseStatistics"></a>

### **`GET /api/v1/courses/{courseId}/statistics`**

Retrieves daily activity, recorded post views, and endorsed-answer response times for a course. Daily activity is grouped by UTC calendar date, includes zero-activity dates, and counts questions and answers at creation, even if later deleted. A recorded view is one successful active canonical post-detail read per signed-in member, post, and UTC date. View history starts when this feature is deployed. Average response time includes questions that first received an endorsed answer during the selected period and measures elapsed time from question creation to creation of that first-endorsed answer. Endorsements are recorded as immutable events, so a later edit that clears the current endorsement does not change this historical measure.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor or TA.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`period` (enum: 7d, 30d, course_to_date, optional; default 30d, values 7d, 30d, course_to_date): Aggregation period. `course_to_date` starts on the earlier UTC date of course creation or the earliest retained statistics-bearing activity, so imported history predating course creation is included.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None specific to this operation.

#### Response body

##### `data` (object, required): Aggregate course activity statistics.

`data.courseId` (string, required): Opaque stable identifier.

`data.period` (enum: 7d, 30d, course_to_date, required): Aggregation period.

###### `data.dailyActivity` (list of objects, required): Activity totals for each UTC calendar date in the selected period, including dates with no activity.

`data.dailyActivity[].date` (string, required): UTC calendar date in ISO 8601 full-date format.

`data.dailyActivity[].questionsCreated` (integer, required): Questions created on the date.

`data.dailyActivity[].answersCreated` (integer, required): Answers created on the date.

`data.dailyActivity[].postsViewed` (integer, required): Recorded post views on the date.

`data.postsViewed` (integer, required): Recorded post views during the period.

`data.averageResponseTimeSeconds` (number or null, required): Mean elapsed seconds from question creation to creation of the answer first endorsed during the period; `null` when no question qualifies.

`data.generatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/statistics' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": {
    "courseId": "course_123",
    "period": "30d",
    "dailyActivity": [
      {
        "date": "2026-09-19",
        "questionsCreated": 5,
        "answersCreated": 4,
        "postsViewed": 86
      },
      {
        "date": "2026-09-20",
        "questionsCreated": 3,
        "answersCreated": 6,
        "postsViewed": 104
      }
    ],
    "postsViewed": 190,
    "averageResponseTimeSeconds": 1320.5,
    "generatedAt": "2026-09-20T14:30:00Z"
  }
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: The period is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`permission_denied`: A staff role is required.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="getCoursePulse"></a>

### **`GET /api/v1/courses/{courseId}/statistics/pulse`**

Summarizes every published, non-deleted question in the course, regardless of when the course record was created, so imported semesters are included. Weekday, hour, and week buckets use the requested IANA time zone. A question is answered when it has at least one non-deleted answer, and its first-answer time runs from question creation to that answer's creation. Helpers count distinct non-deleted answers each current member contributed to; anonymous answers never count, so no anonymous author is identified.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor or TA.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`timeZone` (string, optional, at most 64 characters; default `UTC`): IANA time zone name used for weekday, hour, and week buckets, such as `America/New_York`.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

`Cache-Control: private, no-store`: The summary is private to course staff and is not cached.

#### Response body

##### `data` (object, required): The course question pulse.

`data.courseId` (string, required): Opaque stable identifier.

`data.timeZone` (string, required): The IANA time zone used for buckets.

`data.firstQuestionAt` (string or null, required): Creation time of the earliest counted question in ISO 8601 date-time format; `null` without questions.

`data.lastQuestionAt` (string or null, required): Creation time of the latest counted question in ISO 8601 date-time format; `null` without questions.

`data.questions` (integer, required): Counted questions.

`data.answered` (integer, required): Counted questions with at least one non-deleted answer.

`data.unanswered` (integer, required): Counted questions without a non-deleted answer.

`data.medianFirstAnswerMinutes` (number or null, required): Median minutes from question creation to its first non-deleted answer, over answered questions; `null` when none is answered.

`data.hours` (list of 7 lists of 24 integers, required): Questions created per local weekday, Sunday first, and local hour, 0 through 23.

###### `data.weeks` (list of objects, required): One entry per local Sunday-to-Saturday week from the first to the last question's week, including weeks without questions; empty without questions.

`data.weeks[].weekStart` (string, required): The week's local Sunday in ISO 8601 full-date format.

`data.weeks[].questions` (integer, required): Questions created in the week.

###### `data.topics` (list of objects, required): Up to 10 tags, ordered by question count and then name.

`data.topics[].tag` (string, required): Tag name.

`data.topics[].questions` (integer, required): Counted questions with the tag.

`data.topics[].unanswered` (integer, required): Those questions without a non-deleted answer.

`data.topics[].medianFirstAnswerMinutes` (number or null, required): Median first-answer minutes for the tag's answered questions; `null` when none is answered.

###### `data.helpers` (list of objects, required): Up to 5 current members, ordered by answers and then display name.

`data.helpers[].userId` (string, required): Opaque stable identifier.

`data.helpers[].displayName` (string, required): The member's display name.

`data.helpers[].role` (enum: student, ta, instructor, required): The member's course role.

`data.helpers[].answers` (integer, required): Distinct non-deleted, non-anonymous answers the member contributed to.

`data.generatedAt` (string, required): UTC timestamp in ISO 8601 date-time format.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/statistics/pulse?timeZone=America/New_York' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

The `hours` example is shortened; each response holds 7 lists of 24 counts.

```json
{
  "data": {
    "courseId": "course_123",
    "timeZone": "America/New_York",
    "firstQuestionAt": "2024-09-03T14:30:00Z",
    "lastQuestionAt": "2024-09-24T02:00:00Z",
    "questions": 3,
    "answered": 2,
    "unanswered": 1,
    "medianFirstAnswerMinutes": 45,
    "hours": [
      [0, 0, "…"],
      [0, 0, "…"]
    ],
    "weeks": [
      { "weekStart": "2024-09-01", "questions": 2 },
      { "weekStart": "2024-09-08", "questions": 0 },
      { "weekStart": "2024-09-15", "questions": 0 },
      { "weekStart": "2024-09-22", "questions": 1 }
    ],
    "topics": [
      {
        "tag": "hw1",
        "questions": 2,
        "unanswered": 0,
        "medianFirstAnswerMinutes": 45
      },
      {
        "tag": "hw2",
        "questions": 1,
        "unanswered": 1,
        "medianFirstAnswerMinutes": null
      }
    ],
    "helpers": [
      {
        "userId": "user_123",
        "displayName": "Kevin Darby",
        "role": "ta",
        "answers": 13
      }
    ],
    "generatedAt": "2026-11-06T14:30:00Z"
  }
}
```

#### Errors

##### `400 Bad Request`

`invalid_request`: The time zone is not a known IANA zone name or is longer than 64 characters.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`permission_denied`: A staff role is required.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="listStudentStatistics"></a>

### **`GET /api/v1/courses/{courseId}/statistics/students`**

Lists current student members, including those with zero activity, and their question, answer, and recorded post-view activity during the selected period. Question counts survive later post soft deletion through a per-student UTC-day count with no post link. Active questions at deployment are backfilled; questions deleted before deployment are not reconstructed. Account deletion removes that user's question buckets. An answer contribution counts once per distinct answer with a recorded contribution event during the period. Answer creation and content-changing edits record contribution events; a no-op edit does not. Historical activity remains in course totals after membership or role changes but does not create a roster row.

For `course_to_date`, the period includes retained imported activity on UTC dates before the ChalkTalk course was created.

**Authentication:** `Cookie: __Host-chalktalk_session=<opaque-session>`.

**Access:** Instructor or TA.

**Request media:** None.

#### Request headers

`Accept: application/json` (optional): Requests the documented JSON response when the success response has a body.

`Cookie` (required): Supplies the `__Host-chalktalk_session` opaque session credential.

#### Path parameters

`courseId` (string, required, 1–255 characters): Identifies the course resource.

#### Query parameters

`period` (enum: 7d, 30d, course_to_date, optional; default 30d, values 7d, 30d, course_to_date): Aggregation period.

`cursor` (string, optional; minimum length 1, maximum length 2048): Opaque cursor returned by the previous page.

`limit` (integer, optional; default 25, minimum 1, maximum 100): Page size; defaults to 25.

#### Request body

None.

#### Multipart parts

None.

**Success:** `200 OK`.

**Response media:** `application/json`.

#### Response headers

None specific to this operation.

#### Response body

##### `data` (list of objects, required): Per-student activity statistics returned by this request.

`data.user` (object, required): User identity and profile summary.

`data.questionsCreated` (integer, required): Questions created by the student during the period, including those later soft-deleted after this feature was deployed; predeployment deleted questions are unavailable.

`data.answersContributed` (integer, required): Distinct answers with a recorded contribution event by the student during the period.

`data.postsViewed` (integer, required): Recorded post views by the student during the period.

`page` (object, required): Pagination details for the current result set.

#### Example request

```bash
curl --request GET '/api/v1/courses/course_123/statistics/students' \
    --header 'Accept: application/json' \
    --header 'Cookie: __Host-chalktalk_session=opaque_session'
```

#### Example success response

```json
{
  "data": [
    {
      "user": {
        "id": "user_123",
        "displayName": "Ada Lovelace"
      },
      "questionsCreated": 4,
      "answersContributed": 3,
      "postsViewed": 38
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

`invalid_request`: The period or pagination is invalid.

##### `401 Unauthorized`

`authentication_required`: Authentication is missing or invalid.

##### `403 Forbidden`

`permission_denied`: A staff role is required.

##### `404 Not Found`

`not_found`: The course is absent or hidden.

##### `500 Internal Server Error`

`internal_error`: The server could not complete the request.

##### `503 Service Unavailable`

`service_unavailable`: A required service is temporarily unavailable.

---

<a id="exportDailyStatistics"></a>

### **`GET /api/v1/courses/{courseId}/statistics/export/daily`**

Downloads the selected period's zero-filled UTC daily activity as a server-generated CSV. Counts follow the course summary above, including activity retained after later soft deletion.

For `course_to_date`, the CSV uses the same historical start date as the JSON course summary, including imported activity before course creation.

**Authentication:** Session cookie. **Access:** Current instructor or TA.

**Query:** `period` (`7d`, `30d`, or `course_to_date`; optional, defaults to `30d`).

**Success:** `200 OK`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="chalktalk-{courseId}-{period}-daily.csv"`, `Cache-Control: private, no-store`.

The UTF-8 CSV uses CRLF records and columns `date,questions_created,answers_created,posts_viewed`. It includes every UTC date in the selected period, including zero-activity dates.

**Errors:** `400 invalid_request` for an invalid period; `401 authentication_required`; `403 permission_denied` for nonstaff; `404 not_found` for a missing or hidden course; `500 internal_error`; `503 service_unavailable` for an unavailable statistics service. Errors use the standard JSON error envelope, not CSV.

---

<a id="exportStudentStatistics"></a>

### **`GET /api/v1/courses/{courseId}/statistics/export/students`**

Downloads the complete current non-deleted student roster and selected-period activity as a server-generated CSV. It is not limited by the browser's loaded pages. Current students with zero activity are included; historical activity and privacy rules follow the student statistics endpoint above.

For `course_to_date`, historical imported question and answer attribution predating course creation is included for current students.

**Authentication:** Session cookie. **Access:** Current instructor or TA.

**Query:** `period` (`7d`, `30d`, or `course_to_date`; optional, defaults to `30d`).

**Success:** `200 OK`, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="chalktalk-{courseId}-{period}-students.csv"`, `Cache-Control: private, no-store`.

The UTF-8 CSV uses CRLF records and columns `user_id,display_name,questions_created,answers_contributed,posts_viewed`, ordered by user ID. Display names are CSV-escaped and leading spreadsheet formula triggers are prefixed with an apostrophe.

**Errors:** Same as the daily export endpoint. Errors use the standard JSON error envelope, not CSV.
