## Why

Followers already receive activity email, but a response message contains neither the response text nor a link to the specific answer or followup. A queued message can also outlive an explicit unfollow, making delivery surprising and potentially unsafe as private audiences expand.

## What Changes

- Enhance existing emails for newly created answers, root followups, and nested replies with a short, bounded plain-text excerpt and a link to the exact response.
- Check current follow state and readable-post access immediately before delivery. Retain current per-course activity opt-in, unread-only rule, mention deduplication, and anonymous-identity protection.
- Make exact-response links reveal and focus their destination in the browser, including paginated or collapsed nested replies.
- Keep older queued jobs compatible; do not introduce an owner-only email pipeline or new email categories.

## Capabilities

### New Capabilities

- `response-notification-email`: Delivery, content, privacy, and navigation contract for response activity email.

### Modified Capabilities

None.

## Impact

Notification job payload and worker, answer/followup creation paths, question detail browser rendering, notification documentation, and automated API/worker/browser tests. No new public API or database migration is planned.
