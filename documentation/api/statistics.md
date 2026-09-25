## Statistics

<a id="getCourseStatistics"></a>

### **`GET /api/v1/courses/{courseId}/statistics`**

Retrieves daily activity, post views, and endorsed-answer response times for a course. Daily activity is grouped by UTC calendar date. Average response time includes questions that first received an endorsed answer during the selected period and measures the elapsed time from question creation to endorsement.

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

`data.averageResponseTimeSeconds` (number or null, required): Mean elapsed seconds from question creation to first endorsement for questions that first received an endorsed answer during the period; `null` when no question qualifies.

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

Lists each student's question, answer, and post-view activity during the selected period. An answer contribution counts once per distinct answer the student created or edited, regardless of the number of edits.

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

`data.questionsCreated` (integer, required): Questions created by the student during the period.

`data.answersContributed` (integer, required): Distinct answers the student created or edited during the period.

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
