## Why

The course-project operator does not own a sending domain. Replace the unmerged Resend transport with Gmail API HTTPS, authorized once by the operator's Gmail account, while keeping Mailpit SMTP locally.

## What Changes

- Select `gmail` explicitly with an OAuth client ID, client secret, refresh token, and account sender.
- Send RFC 2822 MIME through Gmail `users.messages.send` using a refreshed access token, including rich inline CID images.
- Freeze MIME bytes with queued messages so an ambiguous retry uses the same payload; retries may duplicate because Gmail offers no idempotency key.
- Keep the existing outbox eligibility, privacy, cancellation, and provider-switch safeguards.
- Provide a local-only OAuth bootstrap helper and deployment guidance; no public OAuth route.

## Impact

API and worker transport/configuration, queued message snapshots, tests, and email docs. No UI or trigger changes. Live Gmail sending requires operator-provided OAuth secrets.
