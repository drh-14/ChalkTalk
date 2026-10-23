## ADDED Requirements

### Requirement: Organized catalog integration

Named links SHALL be managed catalog entries with section/visibility/version metadata while retaining safe HTTP(S), Unicode title limits and authorized idempotent creation.
Successful link creation and unexpired pre-migration replays SHALL return the current catalog response shape and an ETag for the returned version, including links whose legacy ID collided with a file ID.
An identical replay of a previously successful link creation MAY return the original success response after archival without creating another link. This exception SHALL still require the current authenticated same-course instructor, matching request hash and an unexpired key; a fresh archived creation SHALL return 409.

#### Scenario: A catalog item is restricted

- **WHEN** an unauthorized member requests the item through an existing endpoint
- **THEN** the endpoint does not disclose the item

#### Scenario: An archived instructor retries an existing link

- **WHEN** the current same-course instructor repeats a successful link creation with its original unexpired key and identical request after archival
- **THEN** the original success response is returned without a new link write; a changed request or fresh key returns 409
