## Why

Authors are not directly notified when staff confirm that their question duplicates another post. They should receive a clear explanation and a link to the canonical post without having to rediscover where their question went.

## What Changes

- When a TA or instructor successfully confirms a **question** as a duplicate, queue an email to its author in the same transaction as the merge.
- Send a plain-text email with the subject `Your post has been marked as a duplicate`, the question title, the active staff member's name and role, and a link to the canonical post. If the confirming staff account is deleted before delivery, use an unnamed role label instead of retaining or exposing the erased name.
- Retry temporary SMTP failures through the existing durable jobs worker. Suggestions, failed or repeated confirmations, unmerges, notes, and unrelated post updates do not enqueue this email.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: Staff confirmation of a question duplicate now creates a durable author notification, without changing the merge response.

## Impact

The post update transaction, existing `jobs` worker, SMTP sender wiring, post integration tests, and text-post API/spec documentation change. No new endpoint, frontend behavior, migration, or external dependency is required. SMTP retries are at least once: a crash after acceptance but before recording success can rarely produce a duplicate email.
