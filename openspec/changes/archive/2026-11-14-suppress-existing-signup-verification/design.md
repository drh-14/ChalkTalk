## Context

The public verification endpoint is shared by account creation and same-domain email changes. It currently sends mail for every valid address and replies `202` for both new and existing accounts. Account creation and profile update already reject email uniqueness conflicts. The password-reset flow uses a one-second response floor to avoid account discovery by status and ordinary timing.

## Goals / Non-Goals

**Goals:** Avoid unusable signup mail and tokens for active accounts; preserve the public response contract, rate limits, idempotency, and meaningful signup guidance.

**Non-Goals:** Expose a public email-availability check, change login/reset semantics, alter email syntax, or guarantee timing indistinguishability against all network/provider variance.

## Decisions

- After validation and rate-limit checks, query for an active user by normalized email before token persistence. The check applies to the shared verification endpoint; a replacement address already owned by another account cannot be used for an email change anyway. A request for the current email does not issue a redundant proof.
- For registered addresses, skip token generation, token persistence, and delivery. Record an idempotency result for keyed requests just as for new addresses. Retain the final unique constraint and `email_in_use` handling at account creation for races.
- Keep `202` and its headers/body unchanged. Apply a two-second minimum response duration to first successful verification requests, using the existing injectable auth timing seam. This matches the established reset pacing strategy but cannot conceal unusually slow email-provider calls; document that residual side channel.
- Use a single generic UI confirmation with links to sign-in and password reset. Do not put account existence in the HTTP status, body, or UI.

## Risks / Trade-offs

- The user of an existing account receives no email and must discover sign-in/reset from generic guidance. This is less immediate than an explicit error but avoids straightforward account enumeration.
- A fixed two-second floor adds latency to fast new-account requests. Provider calls slower than the floor can still differ; fully eliminating that channel would require a queued, asynchronous delivery design outside this change.
- A new account created concurrently after the lookup can still receive a verification token; unique-account creation remains authoritative and rejects it safely.
