## Why

The `.edu` signup restriction prevents people using otherwise valid email addresses from creating ChalkTalk accounts. Email verification, rather than the top-level domain, should establish mailbox control.

## What Changes

- Accept syntactically valid normalized ASCII email addresses at verification and token-backed account creation regardless of domain suffix.
- Preserve exact-domain organization grouping for **all** domains, including public email providers, and preserve same-domain verified email changes.
- Remove the browser's `.edu` signup check and academic-only signup language; keep syntax and length checks.
- Update API, OpenAPI, system, and database references to match.

## Capabilities

### Modified Capabilities

- `authentication`: email admission, account creation, profile email changes, and signup form validation.

## Impact

Authentication API and web signup, tests, and documentation. No migration or new dependency. Users at public domains such as `gmail.com` will share an organization and its organization-level course listing under the existing model.
