## Why

The documented course and membership APIs are absent, and the authenticated home page shows static courses. Users need real course creation, discovery, joining, and management before course discussions can be attached to courses.

## What Changes

- Implement the course and membership operations in `documentation/api/courses.md` and `documentation/api/course-memberships.md`.
- Implement the already-documented authenticated `GET /api/v1/organizations` prerequisite so browser course creation can select the caller's direct organization.
- Migrate the existing course tables to the agreed `documentation/database.md` model and add durable course deletion jobs.
- Replace the home page's static course list with live course views and management actions.
- Add specification derived API integration tests and frontend client and React Testing Library tests.

## Capabilities

### New Capabilities

- `course-management`: Authenticated course lifecycle, membership, and browser management flows.

### Modified Capabilities

- None.

## Impact

- Changes the API course routes, course service, database migrations, deletion worker, and existing account deletion coordination.
- Changes the protected web home and course views, while posts remain static.
- Adds no new runtime or browser dependency.
