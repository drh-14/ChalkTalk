## ADDED Requirements
### Requirement: Standalone deletion preserves an active syllabus
The standalone file deletion API SHALL retain its uploader-plus-current-instructor authorization and SHALL reject deleting a file referenced as the active syllabus with 409 file_in_use, without hiding the file or enqueuing byte deletion.
#### Scenario: Uploader deletes active syllabus
- **WHEN** an authorized uploader deletes a file currently referenced as the course syllabus
- **THEN** the response is 409 file_in_use and the syllabus remains downloadable
