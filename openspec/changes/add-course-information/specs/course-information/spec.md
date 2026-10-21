## ADDED Requirements
### Requirement: Members read and instructors manage information
The system SHALL return course information only to current same-course members, with Markdown description, optional validated HTTP(S) website, one syllabus and an opaque ETag. Same-course instructors SHALL save active-course information with If-Match; stale/missing conditions SHALL return 412/428. Archived courses SHALL remain readable and reject writes with 409. Nonmember reads SHALL return 404. Unsafe routes SHALL require existing Origin and CSRF validation. Description SHALL be at most 50,000 Unicode characters; websites SHALL be at most 2,048 characters without credentials, whitespace or controls.
#### Scenario: Student reads an empty course
- **WHEN** a current student reads information for a course with no saved information
- **THEN** the response is 200 with empty description, null website/syllabus and version 1, private no-store and ETag, without a write
#### Scenario: Instructor saves stale information
- **WHEN** another save has advanced the information version
- **THEN** a stale conditional save returns 412 and leaves existing information unchanged
### Requirement: Staff roster reflects current memberships
The roster SHALL include only current same-course instructors/TAs and current names/roles, without exposing account emails implicitly. Instructors SHALL conditionally edit contact, location and office-hours text of at most 2,000 Unicode characters per field. Metadata SHALL NOT grant staff privileges; deleted users, removed members and students SHALL NOT appear.
#### Scenario: TA becomes a student
- **WHEN** the TA membership is demoted
- **THEN** its staff profile is absent from the roster even if descriptive metadata remains
### Requirement: Syllabus replacement is atomic and reference safe
Validated syllabus uploads SHALL use the existing file limits and formats, atomically associate with information under course/file locks and conditional version checks, preserve the old syllabus on failure, and asynchronously clean unreferenced replaced/removed bytes. Downloads SHALL require current membership in the actual course including legacy file URLs. Standalone deletion SHALL reject active syllabus references with 409 file_in_use. Archived courses SHALL be download-only.
#### Scenario: Replacement validation fails
- **WHEN** an instructor uploads an invalid file as replacement
- **THEN** the API rejects it and the previous syllabus remains downloadable
#### Scenario: Instructor loses course membership
- **WHEN** the former instructor requests the syllabus through its direct or legacy URL
- **THEN** the API returns 404 without accessing object bytes
### Requirement: Resources includes information and staff tabs
The course resources page SHALL provide Course information, Staff and Resources tabs, initially preserving the existing Resources view. Members SHALL read formatted Markdown and staff details; only active-course instructors SHALL see editors. Stale/error saves SHALL retain draft text with a recoverable message. The layout SHALL remain usable on mobile.
#### Scenario: Student views course information
- **WHEN** a student selects Course information
- **THEN** Markdown is rendered and no management controls appear
