## Why

The deployment-specific school-domain allowlist prevents students at other `.edu` institutions from registering. ChalkTalk should accept any verified academic `.edu` email while keeping courses scoped to each exact school domain.

## What Changes

- Remove `ALLOWED_SCHOOL_DOMAINS` configuration.
- Require a syntactically valid domain ending in `.edu` for verification, account creation from a verification token, and verified email changes.
- Validate signup email locally before requesting verification; keep login and password reset unchanged.
- Preserve exact-domain organization/course boundaries and the existing `email_domain_not_allowed` API code.

## Capabilities

### Modified Capabilities

- `authentication`: academic email admission and profile changes.

## Impact

Authentication service and UI, configuration and deployment examples, auth API docs, tests. No database migration.
