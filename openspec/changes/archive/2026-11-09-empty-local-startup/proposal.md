## Why

Local startup currently has two Compose profiles and an automatic demo-seed job. That makes a new installation look populated before anyone creates or imports a course, and exposes demo credentials as environment settings.

## What Changes

- **BREAKING**: `docker compose up` starts the complete local application, data services, and monitoring without selecting a profile. It runs migrations but does not create sample users or courses.
- Remove the automatic mock-seed service and demo/mock credential variables from local configuration.
- Keep Piazza course import as an explicit command for a course the operator chooses. The import command no longer accepts a shared demo password; imported historical identities use non-login random credentials.
- Update local documentation to describe empty startup, explicit import, and the single Compose command.

## Capabilities

### Modified Capabilities

- `local-compose-deployment`: one default local Compose startup includes application, data, and monitoring services without seeding.
- `local-prototype-fixtures`: fixture helpers remain for tests, but are not part of application startup or user configuration.
- `piazza-course-import`: explicit import does not expose a demo-password environment option.

## Impact

Local Compose, environment templates, the Piazza import CLI, local README instructions, and focused configuration/import tests. Existing local volumes are not erased.
