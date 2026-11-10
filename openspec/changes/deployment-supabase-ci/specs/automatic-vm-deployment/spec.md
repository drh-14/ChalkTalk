## ADDED Requirements

### Requirement: Disposable pre-merge provider integration

Pull-request CI SHALL start a local Supabase PostgreSQL and private S3-compatible Storage instance without production secrets, run ChalkTalk migrations and API containers against it, and test real HTTP authentication, course, and resource flows including unauthorized access and provider failure.

#### Scenario: Authorized flow

Given an empty local Supabase instance, when a test account signs in, creates a course, and uploads a resource through the API, then authorized download returns the original bytes and the object is present in local Storage.

#### Scenario: Denial and failure

Given the same course, when an unauthorized account requests its private resource or a storage operation fails, then the API rejects the request without exposing private bytes or leaving a committed resource row.

#### Scenario: Cleanup

After the CI job succeeds or fails, local API and migration containers and the disposable Supabase data SHALL be stopped and removed.
