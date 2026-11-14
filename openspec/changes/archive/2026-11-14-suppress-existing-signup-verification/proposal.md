## Why

Creating an account with an email that is already registered currently sends another signup-verification email even though account creation will ultimately reject the address. This is confusing and unnecessary. The public endpoint must still avoid revealing which addresses are registered.

## What Changes

- Check for an active account before issuing a verification token or sending verification mail. Suppress both for an already-registered address.
- Keep the public `202 Accepted` response identical for registered and new valid addresses, retain rate limits and idempotency, and pace successful requests to reduce timing-based account discovery.
- Give signup users generic sign-in and password-reset guidance after requesting verification, without an account-existence error.

## Capabilities

### Modified Capabilities

- `authentication`: verification-request privacy and signup confirmation behavior.

## Impact

Authentication service and integration tests, signup UI/browser tests, auth API and OpenAPI references. No database migration or new dependency.
