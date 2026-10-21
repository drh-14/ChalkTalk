## ADDED Requirements

### Requirement: Organized catalog integration

Catalog files SHALL enforce current effective resource visibility at listing and download, prevent standalone deletion while actively referenced and support atomic validated-file association with metadata-bound idempotency. Standalone ownership remains uploader plus current instructor.
Legacy file-list cursors SHALL bind the actual course, effective current class/staff access and catalog visibility version; a role or catalog change SHALL make an earlier cursor invalid before pagination.
An identical replay of a previously successful upload MAY return the original success response after archival without creating or replacing a file. This exception SHALL still require the current authenticated same-course instructor, matching request hash and an unexpired key; a fresh archived upload SHALL return 409.

#### Scenario: A catalog item is restricted

- **WHEN** an unauthorized member requests the item through an existing endpoint
- **THEN** the endpoint does not disclose the item

#### Scenario: An archived instructor retries an existing upload

- **WHEN** the current same-course instructor repeats a successful upload with its original unexpired key and identical request after archival
- **THEN** the original success response is returned without a new file write; a changed request or fresh key returns 409

#### Scenario: Catalog visibility changes during a legacy file listing

- **WHEN** a member requests another file page using a cursor issued before an instructor changed catalog visibility
- **THEN** the API rejects the stale cursor instead of skipping a newly visible file
