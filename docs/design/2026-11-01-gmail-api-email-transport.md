# Gmail API HTTPS delivery for application email

Date: 2026-11-01

## Goal and scope

ChalkTalk sends authentication, announcement, followed-post activity, live-session invitation, duplicate-question, and daily-digest email through one `EmailSender` interface. Local development retains Mailpit SMTP. The course-project deployment uses one operator-authorized personal Gmail account through the Gmail HTTPS API; students do not grant Google OAuth access. There is no public callback route and no change to which events create email.

## Design

The API and worker select `EMAIL_PROVIDER=gmail` with the same `EMAIL_FROM`, OAuth client ID, client secret, and offline refresh token. `EMAIL_FROM` must be the authorized Gmail address or a configured send-as alias; Google enforces sender ownership. The adapter requests short-lived access tokens from Google's token endpoint and sends RFC 2822 MIME messages as base64url `raw` to `users.messages.send`. Nodemailer's stream transport composes text, HTML, and inline CID images without SMTP delivery. The adapter caches a valid access token in process memory and bounds external requests to 30 seconds. Provider responses are accepted only when they contain a message ID.

PostgreSQL remains the queue owner. Before any queued send, the job or digest freezes the logical message and exact MIME bytes along with its provider. Every retry reuses those MIME bytes. Eligibility is checked again under the existing send-time database transaction: recipient address, preferences, membership, referenced-content access/lifecycle/body, sender identity, and represented images. A provider switch or invalidation cancels and scrubs the pending snapshot. The transaction holds access-changing rows locked through the provider call, preserving strict access serialization.

Gmail has no idempotency key. If it accepts a message and the connection drops before acknowledgment, a retry can send a duplicate. This is accepted for the under-50-user pilot. OAuth credential failures and HTTP 429 quota/rate responses hold eligible queued mail for 15-minute retries even past the ordinary attempt limit. The operator should monitor queue age and dead jobs. An accepted API response is not proof of inbox delivery. Do not log credentials or mail bodies.

## OAuth bootstrap and operation

The operator enables Gmail API, configures a Desktop app OAuth client, publishes the consent app as appropriate, then runs the local-only `scripts/gmail-oauth-setup.mjs` helper with the client ID and secret. The helper requests only `gmail.send` with offline access and PKCE S256, validates loopback state, exchanges the authorization code, and writes the refresh token to ignored `.env.gmail.local` with owner-only permissions. It does not add an application route. The operator transfers the refresh token into the API and worker secret stores. `GMAIL_API_BASE_URL` and `GMAIL_TOKEN_URL` are for isolated mock testing only; real deployment uses Google defaults. Local Mailpit remains the default with no Google credentials.

## Alternatives rejected

- Resend: needs a verified domain the operator does not own.
- SES with Gmail sender: delivery/authentication risk for Gmail's domain.
- SMTP in Railway Hobby: outbound SMTP is unavailable.
- OAuth for each student: unnecessary; only the sender account authorizes the worker.
