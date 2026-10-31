## Why

A lost success response leaves a Threads form or file control ready to retry, but a new idempotency key can create duplicate content.

## What Changes

- Keep the submission key for retries of unchanged board, conversation, reply, and attachment payloads.
- Rotate keys after success or when text or selected file changes.
- Add spacing between adjacent conversation deletion and notification controls.

## Scope

Browser client and Threads controls only; backend idempotency and pagination remain unchanged.
