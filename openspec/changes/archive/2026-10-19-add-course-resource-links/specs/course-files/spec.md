## MODIFIED Requirements

### Requirement: Course Resources file interface

The Resources route SHALL display actual course files alongside named external links as specified in course-resource-links. Existing immutable file upload, authenticated original-byte download and permissions SHALL remain unchanged. File names SHALL be the download links without additional Download text or buttons. Only current active-course instructors SHALL see upload controls. Failed upload SHALL preserve the list and same-file retry SHALL reuse the idempotency key; selecting another file SHALL reset it. Loading, empty, error/retry and pagination feedback SHALL remain accessible and responsive. No file delete UI or custom viewer SHALL be added.

#### Scenario: Instructor uploads
- **WHEN** an active-course instructor uploads a supported file
- **THEN** progress and success or failure feedback appears and success refreshes the mixed list

#### Scenario: Readonly members
- **WHEN** a TA, student or archived-course instructor opens Resources
- **THEN** files can be downloaded and named external links opened but creation controls are absent
