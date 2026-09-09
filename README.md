# ChalkTalk

## M1 — Proposal and Requirements

**Project:** ChalkTalk  
**Milestone:** M1 — Proposal and Requirements

---

## 1. Problem

Existing course discussion platforms such as Piazza and Ed Discussion become increasingly difficult to navigate as a semester progresses. Large courses may accumulate hundreds or thousands of posts discussing assignments, deadlines, course policies, lecture material, debugging problems, exams, and previously answered questions.

Although existing platforms provide search and organization features, students often have difficulty locating an existing discussion unless they know the exact wording used in the original post.

As a result:

- students frequently create duplicate questions,
- teaching assistants and instructors repeatedly answer the same questions,
- useful answers become buried in old discussions,
- students have difficulty determining which answers are authoritative,
- course staff have difficulty identifying unresolved questions,
- important course knowledge becomes fragmented across many threads.

**ChalkTalk** is a course discussion platform designed to make course communication easier to search, organize, and maintain throughout a semester.

The central goal of ChalkTalk is to turn a course's discussion history into a reusable and searchable knowledge base while preserving the familiar workflow of asking questions, answering questions, and participating in discussion threads.

A central feature of ChalkTalk is **semantic duplicate detection**. While a student writes a new question, ChalkTalk searches the existing course discussion and displays semantically similar questions. This allows a student to find an existing answer even when their wording differs from the wording of the original post.

For example:

```text
Student draft:
"When do we need to submit Homework 3?"

Existing discussion:
"HW3 submission deadline clarification"
```

ChalkTalk should recognize that these discussions are likely related even though they do not use exactly the same words.

---

# 2. Target Users

ChalkTalk is primarily designed for university and college courses.

The system has three primary user groups:

1. Students
2. Teaching Assistants
3. Instructors

## 2.1 Students

Students use ChalkTalk to:

- search previous discussions,
- ask questions,
- answer questions,
- contribute to collaborative student answers,
- participate in follow-up discussions,
- view course resources,
- vote in polls,
- follow discussions,
- optionally post anonymously,
- find existing answers before creating duplicate questions.

## 2.2 Teaching Assistants

Teaching assistants use ChalkTalk to:

- answer student questions,
- collaboratively maintain staff answers,
- endorse correct answers,
- moderate discussions,
- mark questions as duplicates,
- manage tags,
- upload course resources,
- identify unanswered questions.

## 2.3 Instructors

Instructors use ChalkTalk to:

- create and manage courses,
- assign course roles,
- manage course enrollment,
- publish information,
- upload course resources,
- moderate course discussions,
- configure course settings,
- manage anonymity behavior,
- endorse authoritative answers,
- archive completed courses,
- view course activity and statistics.

---

# 3. Why This Is a Semester Project

ChalkTalk is not a single isolated feature or a simple wrapper around an AI model.

The system requires several interacting workflows operating over shared persistent data.

The project includes:

- persistent user accounts,
- authentication,
- email verification,
- password recovery,
- multiple independent courses,
- course membership,
- role-based authorization,
- multiple discussion post types,
- collaborative answers,
- nested discussion threads,
- concurrent editing,
- full-text search,
- semantic search,
- duplicate-question detection,
- image and document uploads,
- course resource management,
- anonymity rules,
- moderation,
- notifications,
- statistics,
- persistent database storage.

These systems also interact with one another.

For example:

- semantic search must only return posts that the requesting user is authorized to view,
- anonymous users must remain anonymous in search results and notifications,
- collaborative answers must prevent one editor from silently overwriting another editor's work,
- archived courses must remain readable while rejecting new posts,
- course permissions must be enforced by the backend,
- deleted or restricted resources must not remain visible through search,
- AI or embedding systems must not receive data that the current user is not permitted to access.

The project therefore involves persistent shared state, multiple roles, concurrency, information retrieval, security, moderation, file handling, and a substantial frontend.

---

# 4. Core Product Workflows

## 4.1 Student Searches Before Asking

```text
Student opens course
        |
        v
Student begins writing a question
        |
        v
ChalkTalk searches for similar questions
        |
        v
Student reviews existing discussions
        |
        +-------------------------------+
        |                               |
        v                               v
Existing answer solves problem     No suitable answer exists
        |                               |
        v                               v
Student opens discussion           Student submits new question
```

This workflow directly addresses the primary problem ChalkTalk is intended to solve.

---

## 4.2 Course Staff Resolve a Question

```text
TA finds unanswered question
        |
        v
TA contributes to staff answer
        |
        v
Another TA or instructor may edit
        |
        v
Version checks protect existing edits
        |
        v
Staff member endorses final answer
        |
        v
Students see authoritative response
```

---

## 4.3 Student Searches Existing Knowledge

```text
Student enters natural-language query
        |
        v
Full-text + semantic search
        |
        v
Course permissions applied
        |
        v
Anonymity rules applied
        |
        v
Relevant results ranked
        |
        v
Student opens existing discussion
```

---

## 4.4 Instructor Manages a Course

```text
Instructor creates course
        |
        v
Students join course
        |
        v
Instructor assigns TAs
        |
        v
Discussions and resources accumulate
        |
        v
Instructor moderates course
        |
        v
Course is archived after semester
```

---

# 5. User Stories

## 5.1 Student User Stories

### S1 — Search Existing Discussions

**As a student, I want to search course discussions using natural language so that I can find an answer even when I do not know the exact wording of the original post.**

Acceptance criteria:

- search only returns content from the selected course,
- results are ranked by relevance,
- results show useful identifying information,
- users may filter search results,
- restricted content is not returned to unauthorized users.

---

### S2 — Avoid Duplicate Questions

**As a student, I want to see similar questions while writing a new question so that I can avoid posting something that has already been answered.**

Acceptance criteria:

- similar posts are shown before submission,
- posts containing endorsed answers are clearly identified,
- the student can open a suggested discussion,
- opening a suggestion does not immediately destroy the student's draft,
- the student may still submit the new question if necessary.

---

### S3 — Ask a Question

**As a student, I want to create a formatted question so that I can clearly explain what I need help with.**

Acceptance criteria:

- questions support Markdown,
- questions support LaTeX,
- images and supported documents may be attached,
- formatting can be previewed,
- submitted questions persist after refresh,
- submitted questions persist after logout and later login.

---

### S4 — Post Anonymously

**As a student, I want to post anonymously so that I can ask a question without exposing my identity to classmates.**

Acceptance criteria:

- anonymous posts display `Anonymous`,
- anonymity is enforced by the backend,
- hidden identity information is not returned through unauthorized API requests,
- search results preserve anonymity,
- follow-ups preserve anonymity,
- notifications preserve anonymity.

---

### S5 — Contribute to a Student Answer

**As a student, I want to contribute to a shared student answer so that students can collectively improve an explanation.**

Acceptance criteria:

- each question may contain one collaborative student answer,
- students may edit the collaborative student answer,
- contributors are recorded,
- staff may endorse the answer,
- endorsed answers become read-only until endorsement is removed.

---

### S6 — Participate in Follow-Up Discussion

**As a student, I want to ask follow-up questions so that I can clarify an answer I still do not understand.**

Acceptance criteria:

- users may reply beneath questions and answers,
- replies may receive nested replies,
- discussion branches are visually distinguishable,
- branches may be collapsed,
- staff may lock discussions.

---

### S7 — Follow a Discussion

**As a student, I want to follow a discussion so that I can see when new activity occurs.**

Acceptance criteria:

- users may follow and unfollow a discussion,
- followed discussions may generate in-app notifications.

---

## 5.2 Teaching Assistant User Stories

### TA1 — Create a Staff Answer

**As a teaching assistant, I want to contribute to a shared staff answer so that course staff can maintain one authoritative response.**

Acceptance criteria:

- TAs and instructors may edit the staff answer,
- students may not edit the staff answer,
- multiple staff members may contribute,
- contributors are recorded.

---

### TA2 — Endorse an Answer

**As a teaching assistant, I want to endorse a correct answer so that students can identify authoritative information.**

Acceptance criteria:

- only TAs and instructors may endorse answers,
- endorsed answers are clearly identified,
- endorsed answers are locked against ordinary editing,
- authorized staff may remove endorsement.

---

### TA3 — Mark a Duplicate

**As a teaching assistant, I want to mark a question as a duplicate of an existing discussion so that course information remains organized.**

Acceptance criteria:

- duplicate posts link to a canonical post,
- the duplicate remains viewable,
- users are directed toward the canonical discussion.

---

### TA4 — Find Unanswered Questions

**As a teaching assistant, I want to filter for unanswered questions so that I can quickly identify students who still need help.**

---

## 5.3 Instructor User Stories

### I1 — Create a Course

**As an instructor, I want to create a course so that students and teaching assistants have an isolated discussion space.**

---

### I2 — Manage Course Roles

**As an instructor, I want to assign and revoke TA privileges so that course permissions correspond to the actual teaching staff.**

---

### I3 — Manage Course Resources

**As an instructor, I want to upload and organize course resources so that students can access important documents from the same application.**

---

### I4 — Moderate the Course

**As an instructor, I want to lock, pin, delete, or organize discussions so that the forum remains useful throughout the semester.**

---

### I5 — Archive the Course

**As an instructor, I want to archive a course after the semester so that its content remains available without allowing additional activity.**

---

### I6 — View Course Statistics

**As an instructor, I want to view basic discussion statistics so that I can identify unanswered questions and heavily discussed topics.**

---

# 6. Functional Requirements

## 6.1 Account Creation and Management

### FR-A1 — Registration

A user must be able to create an account using:

- a supported `.edu` email address,
- a password.

For version 1, ChalkTalk restricts registration to `.edu` email addresses.

The system must prevent duplicate registration using the same email address.

---

### FR-A2 — Email Verification

After registration, ChalkTalk sends an email verification link to the provided address.

Users must verify their email before receiving normal access to the application.

Verification links must expire.

---

### FR-A3 — Password Storage

Passwords must never be stored in plaintext.

Passwords must be securely hashed before storage.

---

### FR-A4 — Login

Verified users must be able to authenticate using their email address and password.

Successful authentication establishes a session.

The session must persist through normal page navigation and browser refreshes until logout or session expiration.

---

### FR-A5 — Logout

Users must be able to terminate their current authenticated session.

---

### FR-A6 — Password Modification

Authenticated users must be able to change their password.

---

### FR-A7 — Password Reset

Users who forget their password must be able to request a password reset email.

Password reset links must:

- expire,
- be difficult to guess,
- be single-use,
- become invalid after a successful reset.

---

### FR-A8 — Account Modification

Users must be able to modify supported profile information.

---

### FR-A9 — Account Deletion

Users must be able to delete their account.

The application must consistently define what happens to historical course content associated with deleted accounts.

---

# 6.2 Courses

### FR-C1 — Course Creation

Authenticated users may create courses.

The creator becomes an instructor of the course.

Courses are isolated from one another.

---

### FR-C2 — Course Membership

Students may join a course using a course-specific join code.

Instructors may regenerate the join code.

---

### FR-C3 — Course Roles

Each course supports:

- Student,
- Teaching Assistant,
- Instructor.

A user may have different roles in different courses.

---

### FR-C4 — Role Management

Instructors may:

- promote students to Teaching Assistant,
- revoke Teaching Assistant privileges,
- manage supported course permissions.

Role changes must be enforced by the backend.

---

### FR-C5 — Course Archiving

Instructors may archive a course.

Archived courses:

- remain readable,
- remain searchable,
- reject new posts,
- reject new replies,
- reject new polls,
- reject new members.

---

### FR-C6 — Course Deletion

Instructors may permanently delete a course.

Deletion must require explicit confirmation.

Course deletion removes associated data according to the application's data-retention policy.

---

# 6.3 Posts

ChalkTalk supports three main post types:

1. Questions
2. Notes
3. Polls

Every post includes or references:

- course,
- post type,
- author,
- creation timestamp,
- last modification timestamp,
- body/content,
- tags,
- anonymity state.

---

# 6.4 Questions

### FR-Q1 — Question Creation

Students, TAs, and instructors may create questions.

Questions support:

- Markdown,
- LaTeX,
- image uploads,
- supported document uploads.

---

### FR-Q2 — Similar Question Suggestions

While a user writes a question, ChalkTalk must retrieve similar existing questions from the same course.

Suggested results should prioritize semantically related discussions.

Each suggestion should display:

- title,
- tags,
- answer status,
- endorsed-answer status.

The user must still be allowed to submit the new question.

---

### FR-Q3 — Collaborative Student Answer

Each question may have one shared student answer.

Students may contribute to this answer.

The system records which users have contributed.

---

### FR-Q4 — Collaborative Staff Answer

Each question may have one shared staff answer.

Only teaching assistants and instructors may modify it.

---

### FR-Q5 — Concurrent Editing

Collaborative answers must support multiple users attempting to edit the same answer.

The application must not silently overwrite a newer saved version with an outdated edit.

The system must use version checking or an equivalent conflict-detection mechanism.

If an edit is based on an outdated revision, the user must be notified of the conflict.

---

### FR-Q6 — Answer Endorsement

Teaching assistants and instructors may endorse an answer.

Endorsed answers:

- are visibly marked,
- are treated as authoritative,
- become read-only until endorsement is removed by authorized course staff.

---

### FR-Q7 — Answer Contributors

Collaborative answers record:

- contributors,
- last modification time,
- current version.

---

# 6.5 Follow-Ups and Threads

### FR-T1 — Follow-Ups

Users may create follow-up messages beneath questions and answers.

---

### FR-T2 — Nested Replies

Follow-ups may themselves receive replies.

This creates a nested thread structure.

---

### FR-T3 — Thread Navigation

The interface must make parent/child reply relationships clear.

Nested branches should be collapsible.

---

### FR-T4 — Editing

Users may edit their own follow-ups unless prevented by moderation or course state.

---

### FR-T5 — Locking

Teaching assistants and instructors may lock a discussion.

Locked discussions remain readable but reject new replies.

---

# 6.6 Notes

### FR-N1 — Note Creation

Students, TAs, and instructors may create notes.

Notes are informational posts rather than questions.

---

### FR-N2 — Note Responses

Notes do not have collaborative answer slots.

---

# 6.7 Polls

### FR-P1 — Poll Creation

Teaching assistants and instructors may create polls.

---

### FR-P2 — Poll Options

Polls contain a fixed set of response options.

---

### FR-P3 — Voting

Authorized course members may vote in polls.

The system must prevent invalid duplicate voting.

---

### FR-P4 — Poll Consistency

Voting operations must maintain consistent vote totals under concurrent requests.

---

# 6.8 Search

Search is a central subsystem of ChalkTalk.

### FR-S1 — Full-Text Search

Users must be able to search course discussions using text queries.

---

### FR-S2 — Semantic Search

Users must be able to find semantically related discussions even if different wording is used.

Example:

```text
Search:
"When is HW4 due?"

Possible result:
"Homework 4 deadline clarification"
```

---

### FR-S3 — Course Isolation

Search results must be restricted to the currently selected course.

---

### FR-S4 — Search Filters

Search results may be filtered by:

- tag,
- author,
- date,
- post type,
- answered/unanswered state,
- endorsed-answer state.

---

### FR-S5 — Permission Enforcement

Search must not return content that the requesting user cannot otherwise access.

---

### FR-S6 — Anonymity Preservation

Search results must preserve anonymity settings.

Search APIs must not expose hidden author identity data.

---

# 6.9 Tags and Organization

### FR-G1 — Tags

Posts may contain one or more tags.

Example tags include:

```text
Homework 1
Homework 2
Midterm
Final
Lecture
Logistics
Conceptual
Programming
```

---

### FR-G2 — Tag Management

Teaching assistants and instructors may create and manage course-specific tags.

---

### FR-G3 — Tag Filtering

Users may filter the discussion feed and search results using tags.

---

# 6.10 Post Status

Questions may have statuses including:

- Unanswered,
- Answered,
- Endorsed,
- Resolved,
- Duplicate,
- Locked.

These states may be used in search filters and visual presentation.

---

# 6.11 Pinning

Teaching assistants and instructors may pin important posts.

Pinned posts should be displayed prominently in the course discussion interface.

---

# 6.12 Anonymity

Anonymity must be enforced by the backend rather than only by the frontend.

Users may mark supported content as anonymous according to course rules.

For anonymous content:

- other students see `Anonymous`,
- search results display `Anonymous`,
- thread displays preserve anonymity,
- notifications preserve anonymity,
- unauthorized API responses must not include the hidden identity.

Internally, anonymous posts may remain associated with the author's account for moderation and abuse prevention.

Semantic-search and AI systems must obey the same anonymity restrictions.

---

# 6.13 Course Resources

### FR-R1 — Resource Upload

Teaching assistants and instructors may upload course resources.

Examples include:

- syllabus documents,
- lecture notes,
- assignments,
- exam information,
- course policies,
- reference documents.

---

### FR-R2 — External Resources

Teaching assistants and instructors may add links to external resources.

---

### FR-R3 — Resource Metadata

Each resource contains:

- title,
- optional description,
- resource type,
- uploader,
- upload date.

---

### FR-R4 — Resource Access

Only authorized course users may access private course resources.

---

### FR-R5 — Search Integration

Semantic indexing of uploaded course resources is considered a stretch goal for version 1.

---

# 6.14 Notifications

ChalkTalk will provide basic in-app notifications.

Users may receive notifications when:

- their question receives an answer,
- someone replies to their follow-up,
- their answer is endorsed,
- a followed discussion receives relevant activity.

Email notification digests are outside the initial scope.

---

# 6.15 Moderation

Teaching assistants and instructors may perform moderation actions including:

- pinning posts,
- locking posts,
- deleting or hiding inappropriate posts,
- marking duplicate questions,
- removing inappropriate attachments.

Moderation actions must be protected by server-side authorization.

---

# 6.16 Statistics

Course staff may view basic statistics including:

- total number of questions,
- number of unanswered questions,
- number of answered questions,
- posts over time,
- commonly used tags,
- average time until first response.

More advanced analytics are stretch goals.

---

# 7. Nonfunctional Requirements

## 7.1 Security

The system must protect against:

- unauthorized course access,
- privilege escalation,
- unauthorized role modification,
- account hijacking,
- insecure password storage,
- malicious file uploads,
- cross-site scripting,
- cross-site request forgery where applicable,
- unauthorized resource modification,
- unauthorized access to anonymous identities.

Authorization must be enforced by the server.

The frontend must not be treated as a security boundary.

For example, hiding an instructor-only button does not replace authorization checks on the corresponding backend endpoint.

---

## 7.2 Privacy

Course content must only be visible to users authorized to access the corresponding course.

Anonymous identities must not be revealed through:

- API responses,
- search results,
- notifications,
- frontend metadata,
- semantic-search output,
- AI-generated output.

---

## 7.3 Performance

Normal discussion pages should not require loading an entire semester of discussion history at once.

Pagination, lazy loading, or an equivalent technique should be used where appropriate.

Search should return results within a few seconds under expected course workloads.

Creating a post must not require semantic indexing to finish before the post becomes visible.

---

## 7.4 Persistence

Successfully submitted data must survive:

- page refresh,
- logout,
- later login,
- normal server restart.

Persistent data includes:

- users,
- courses,
- memberships,
- roles,
- posts,
- answers,
- replies,
- poll votes,
- resources,
- moderation state.

---

## 7.5 Concurrency

The system must preserve consistent state when multiple users perform operations simultaneously.

In particular:

- collaborative answer edits must not silently overwrite newer edits,
- poll votes must remain consistent,
- answer endorsements must remain consistent,
- role changes must remain consistent.

---

## 7.6 Reliability

Failed write operations must not appear as successful saves.

Users must receive visible feedback when an operation fails.

---

## 7.7 Usability

Common actions should require a small number of steps.

For example:

- a student should be able to create a question directly from the course discussion page,
- similar questions should appear during question creation rather than requiring a separate manual search,
- endorsed answers should be visually identifiable,
- successful actions should provide clear feedback,
- opening a suggested duplicate should not unnecessarily destroy a draft.

---

## 7.8 Responsive Design

The primary interface should remain usable on:

- desktop screens,
- laptops,
- tablets,
- common mobile browser widths.

A native mobile application is not part of version 1.

---

## 7.9 Accessibility

The frontend should use:

- semantic HTML where practical,
- keyboard-accessible controls,
- descriptive form labels,
- readable text contrast,
- accessible interactive components.

---

# 8. Initial Scope — Version 1

The initial version of ChalkTalk will support the following functionality.

## Accounts

- registration,
- `.edu` email verification,
- login,
- logout,
- password reset,
- password modification,
- profile modification,
- account deletion.

## Courses

- course creation,
- joining by course code,
- Student role,
- Teaching Assistant role,
- Instructor role,
- course-specific authorization,
- course archiving,
- course deletion.

## Discussion

- questions,
- notes,
- polls,
- collaborative student answers,
- collaborative staff answers,
- answer endorsement,
- nested follow-ups,
- Markdown,
- LaTeX,
- image/document attachments,
- editing,
- deletion,
- tags,
- pinning,
- locking,
- anonymous posting.

## Search

- full-text search,
- semantic search,
- similar-question detection,
- search filtering,
- course-specific search,
- permission-aware search.

## Course Resources

- file uploads,
- external links,
- resource listing,
- role-based resource management.

## Notifications

- basic in-app notifications.

## Statistics

- total questions,
- answered/unanswered counts,
- activity over time,
- basic tag statistics.

## Security

- secure password storage,
- session management,
- backend authorization,
- upload validation,
- anonymity enforcement,
- security testing of critical APIs.

---

# 9. Explicitly Out of Scope for Version 1

The following features are not required for the initial release:

- native iOS application,
- native Android application,
- Canvas integration,
- Blackboard integration,
- Brightspace integration,
- university single sign-on,
- automatic university enrollment synchronization,
- assignment submission,
- automatic grading,
- gradebook functionality,
- video conferencing,
- real-time chat,
- direct messages,
- push notifications,
- public cross-course search,
- cross-university search,
- automatically generated authoritative AI answers,
- advanced recommendation systems,
- advanced instructor analytics,
- semantic indexing of every uploaded document,
- real-time character-by-character collaborative editing.

These features may be reconsidered if the core system is completed ahead of schedule.

---

# 10. Nature of the Product

ChalkTalk contains several application-wide rules that affect nearly every subsystem.

## 10.1 Permissions

Course roles determine which actions users may perform.

Permission rules affect:

- posts,
- answers,
- course resources,
- moderation,
- search,
- role management,
- statistics.

Permissions must therefore be enforced centrally by the backend.

---

## 10.2 Anonymity

Anonymity affects:

- posts,
- answers,
- follow-ups,
- search,
- notifications,
- edit history,
- semantic-search context,
- AI-generated output.

Changing anonymity behavior cannot simply be a frontend visual change because hidden identity information must not be exposed through the API.

---

## 10.3 Shared Data

Course discussions are shared persistent objects.

Multiple users may:

- read the same discussion,
- reply to the same question,
- edit the same collaborative answer,
- vote in the same poll,
- search the same course knowledge base.

The backend must maintain consistent shared state.

---

## 10.4 Concurrent Editing

Collaborative answers intentionally allow multiple users to modify the same shared answer.

The system must detect outdated edits and prevent silent lost updates.

A simplified implementation may associate a version number with each answer.

Example:

```text
Current answer version: 7

User A loads version 7.
User B loads version 7.

User A saves.
Current version becomes 8.

User B attempts to save version 7.

Server detects:
expected_version != current_version

Result:
409 Conflict
```

User B is then informed that the answer has changed and can review the newest version before saving again.

---

# 11. Rough Architecture

```text
                         +---------------------------+
                         |        Web Client         |
                         |                           |
                         |  Discussion UI            |
                         |  Search UI                |
                         |  Course UI                |
                         |  Resource UI              |
                         |  Notification UI          |
                         +-------------+-------------+
                                       |
                                     HTTPS
                                       |
                                       v
                  +-----------------------------------------+
                  |              Backend API                |
                  |                                         |
                  |  Authentication / Sessions              |
                  |  Authorization / Permissions            |
                  |  Account Management                     |
                  |  Course Management                      |
                  |  Discussion / Threads                   |
                  |  Collaborative Answers                  |
                  |  Polls                                  |
                  |  Resources                              |
                  |  Notifications                          |
                  |  Statistics                             |
                  |  Search                                 |
                  +--------+---------------+----------------+
                           |               |
                           |               |
                           v               v
              +--------------------+   +--------------------+
              | Relational Database|   | Search / Semantic  |
              |                    |   | Index              |
              | Users              |   |                    |
              | Courses            |   | Post embeddings    |
              | Memberships        |   | Search metadata    |
              | Posts              |   | Similarity search  |
              | Answers            |   +--------------------+
              | Replies            |
              | Polls              |
              | Tags               |
              | Notifications      |
              +---------+----------+
                        |
                        |
                        v
              +--------------------+
              |   Object Storage   |
              |                    |
              | Images             |
              | Documents          |
              | Course Resources   |
              +--------------------+


                 External Services
                 -----------------

         +-------------------------+
         | Email Provider          |
         |                         |
         | Verification Email      |
         | Password Reset Email    |
         +-------------------------+

         +-------------------------+
         | Embedding / AI Service  |
         |                         |
         | Semantic Search         |
         | Similarity Detection    |
         +-------------------------+
```

The backend acts as the trusted boundary of the application.

Permission and anonymity checks must occur before protected information is returned to:

- the frontend,
- semantic-search components,
- external AI services.

---

# 12. Preliminary Data Model

The exact schema may change during development, but the expected major entities are approximately:

```text
User
----
id
email
password_hash
display_name
email_verified
created_at
updated_at


Course
------
id
name
description
join_code
status
created_at
archived_at


CourseMembership
----------------
id
user_id
course_id
role
joined_at


Post
----
id
course_id
author_id
type
title
body
anonymous
status
created_at
updated_at


Answer
------
id
post_id
type
body
version
endorsed
created_at
updated_at


AnswerContributor
-----------------
answer_id
user_id


Reply
-----
id
post_id
parent_reply_id
author_id
body
anonymous
created_at
updated_at


Tag
---
id
course_id
name


PostTag
-------
post_id
tag_id


PollOption
----------
id
post_id
text


PollVote
--------
id
poll_option_id
user_id


Resource
--------
id
course_id
uploader_id
title
description
type
storage_location
created_at


Notification
------------
id
user_id
type
target_id
read
created_at
```

---

# 13. Semantic Search Design

Semantic search is intended to improve discovery beyond exact keyword matching.

A simplified search pipeline is:

```text
Post created or modified
        |
        v
Relevant searchable text extracted
        |
        v
Embedding generated
        |
        v
Embedding stored in search index
        |
        v
Student submits search query
        |
        v
Query embedding generated
        |
        v
Similarity search performed
        |
        v
Course and permission filters applied
        |
        v
Ranked results returned
```

Semantic search does not replace ordinary full-text search.

Version 1 may combine:

- keyword relevance,
- semantic similarity,
- post status,
- tags,
- recency.

The exact ranking formula may change during implementation.

---

# 14. Security Model

Security is particularly important because ChalkTalk contains private course information and multiple privilege levels.

## 14.1 Authentication

Authentication determines which account is making a request.

Authentication protections include:

- secure password hashing,
- session protection,
- email verification,
- expiring reset tokens,
- rate limiting where appropriate.

---

## 14.2 Authorization

Authorization determines whether the authenticated user may perform an operation.

Examples:

```text
Student:
    create question        YES
    edit own post          YES
    edit staff answer      NO
    endorse answer         NO
    assign TA              NO

TA:
    create question        YES
    edit staff answer      YES
    endorse answer         YES
    moderate discussion    YES
    assign instructor      NO

Instructor:
    create question        YES
    edit staff answer      YES
    endorse answer         YES
    moderate discussion    YES
    manage course roles    YES
    archive course         YES
```

Backend endpoints must independently enforce these permissions.

---

## 14.3 Course Isolation

Membership in one course must not imply access to another course.

For example:

```text
User belongs to CSE 150
User does not belong to CSE 214

GET /courses/CSE214/posts
```

must fail unless the user is independently authorized to access CSE 214.

---

## 14.4 Upload Security

Uploaded files must be validated before storage or distribution.

The system should restrict:

- unsupported file types,
- excessively large files,
- suspicious filenames,
- unsafe direct execution of uploaded content.

---

## 14.5 Anonymous Content

Anonymous posting is anonymity within the normal course interface, not necessarily complete deletion of authorship from the backend.

The backend may retain author identity for moderation.

However, unauthorized users must not receive the hidden author identifier.

---

# 15. Basic Statistics

Version 1 statistics may include:

```text
Total Questions
Answered Questions
Unanswered Questions
Endorsed Questions
Questions per Week
Average Time to First Response
Most Common Tags
```

Possible stretch statistics include:

```text
Duplicate Question Rate
Search Usage
Similar-Question Click Rate
Average Search-to-Answer Time
Most Frequently Searched Topics
```

One possible measure of duplicate prevention is:

```text
users who opened a suggested existing question
------------------------------------------------
users who were shown similar-question suggestions
```

This does not perfectly measure whether the student's problem was solved, but it provides an approximate measure of whether the duplicate-detection feature is being used.

---

# 16. Team Responsibilities

Each major subsystem has a primary owner.

Team members may contribute outside their assigned areas, but the listed owner is responsible for coordinating implementation and ensuring completion.

## Nicholas Smirnov

Primary responsibilities:

- authentication,
- account creation,
- account deletion,
- account modification,
- authorization,
- role management,
- session management,
- course permission model,
- anonymity enforcement,
- application security,
- security testing,
- security review of APIs.

---

## Khai Hern Low

Primary responsibilities:

- relational database design,
- database migrations,
- semantic search,
- search indexing,
- similarity ranking,
- database query optimization,
- concurrency/versioning support for collaborative answers.

---

## Jackie Lee

Primary responsibilities:

- frontend architecture,
- frontend UI,
- course discussion interface,
- course resource interface,
- notification interface,
- reusable UI component library,
- responsive design,
- accessibility,
- cross-browser compatibility,
- frontend case testing.

---

## Darren Hamilton

Primary responsibilities:

- project management,
- sprint planning,
- task tracking,
- integration coordination,
- testing coordination,
- acceptance-test coordination,
- project documentation,
- release coordination.

---

# 17. AI Tools

AI tools may be used as development assistants for:

- UI prototyping,
- boilerplate code generation,
- debugging assistance,
- test generation,
- code review,
- documentation,
- implementation brainstorming.

AI-generated code will not be assumed to be correct.

All AI-generated code incorporated into the project must be reviewed and verified by members of the development team.

AI tools are development aids rather than the product itself.

The core ChalkTalk system must continue to function as a course discussion platform even if optional AI-assisted functionality is unavailable.

---

# 18. Definition of a Successful Version 1

Version 1 is successful if the following end-to-end scenario can be demonstrated:

1. A user creates and verifies an account.
2. An instructor creates a course.
3. A student joins the course.
4. The instructor assigns another member as a TA.
5. A student begins writing a question.
6. ChalkTalk displays semantically similar existing questions.
7. The student either opens an existing answer or submits the new question.
8. A TA adds a staff answer.
9. Another staff member edits the collaborative answer without silently overwriting an existing edit.
10. A TA endorses the answer.
11. Another student searches for the same concept using different wording.
12. ChalkTalk returns the existing discussion.
13. Course permissions and anonymity settings remain correctly enforced throughout the workflow.
14. The instructor archives the course.
15. The archived discussion remains readable and searchable while new posts are rejected.

This scenario demonstrates the main value of ChalkTalk while exercising:

- authentication,
- authorization,
- persistent shared data,
- course roles,
- discussion threads,
- semantic search,
- collaborative editing,
- anonymity,
- moderation,
- course lifecycle management.

---

# 19. M1 Deliverables

This repository contains the artifacts required for M1:

- problem definition,
- target users,
- justification for semester-scale development,
- product workflows,
- user stories,
- functional requirements,
- nonfunctional requirements,
- initial scope,
- explicit out-of-scope functionality,
- individual team responsibilities,
- rough architecture,
- preliminary data model,
- security considerations.

The document is intended to contain enough information that another developer could begin implementing the system without having to independently invent the product requirements.
