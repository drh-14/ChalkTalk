# content-upvotes Specification

## Purpose
Lets current course members register at most one upvote on each answer or followup and read accurate aggregate and personal vote state.

## Requirements

### Requirement: Members toggle answer and followup upvotes

`PUT` and `DELETE` on `/api/v1/answers/{id}/upvote` and `/api/v1/followups/{id}/upvote` SHALL be idempotent and require a current member of an active course, session, Origin, and CSRF token. At most one vote per member and target SHALL exist. Members MAY vote on their own content. Votes SHALL not advance the target content version or ETag. Deleted or hidden content SHALL not be votable. Reads in archived courses SHALL retain vote counts but writes SHALL return `409 course_archived`.

#### Scenario: Repeated vote
- **WHEN** a member sends PUT twice for the same answer
- **THEN** both succeed and the answer has one vote from that member

#### Scenario: Vote does not conflict with edit
- **WHEN** another member upvotes a followup
- **THEN** its content ETag remains unchanged
