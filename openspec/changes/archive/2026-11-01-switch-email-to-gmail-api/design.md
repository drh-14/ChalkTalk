## Context

PR #97 already snapshots queued email content and checks eligibility under a send-time database transaction. Gmail API requires one RFC 2822 message encoded as base64url and OAuth access tokens obtained from the operator's refresh token.

## Design

Keep `EmailSender` and select `smtp` or `gmail`. The Gmail adapter composes MIME from the existing text, HTML and inline attachments using Nodemailer stream transport, refreshes OAuth tokens over HTTPS, and sends `raw` to `users.messages.send`. Queued jobs and digests persist the composed MIME before their first network attempt; all retries reuse those exact bytes. Authentication mail composes immediately. The current sender and recipient/content guards remain authoritative and continue locking through provider handoff. A preference opt-out may wait on a recipient membership lock until an in-flight send finishes, and that email may complete before opt-out commits; Gmail's external request is bounded to 30 seconds. No SMTP fallback or public OAuth endpoint. A local CLI helper obtains the refresh token from a state-checked PKCE S256 loopback authorization and writes it to an ignored, owner-readable env file without printing the token.

## Failure model

Transient token/send network failures, 408/5xx and malformed success retry under existing backoff. OAuth credential failures (including revoked refresh tokens) and HTTP 429 quota/rate failures hold eligible queued mail for 15-minute retry even past its ordinary attempt limit; they do not cancel or scrub it. A stale access-token 401 triggers one refresh and same-MIME retry. Permanent bad-message 4xx failures remain terminal. A network drop after Gmail accepts a message is ambiguous; retry can duplicate. Gmail personal-account quota is accepted for the expected under-50-user pilot; queue age and dead jobs must be monitored.
