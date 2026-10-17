## Context

The email-link and reset API are implemented. `App.tsx` owns the reset route and landing sign-in panel. The reset link token is removed from the visible URL but retained in route state until submission.

## Goals / Non-Goals

**Goals:** Validate at the reset form boundary, associate error text with each field, and reuse existing routing and auth messaging.

**Non-Goals:** Change reset-token lifetime, email content, API validation, password policy, or authentication behavior.

## Decisions

1. Add confirmation and explicit submit-time length/match checks in the reset route. Disable browser-native length blocking on this form so the required inline errors are rendered; keep the backend as authority. Alternative: HTML `minLength`/`maxLength` alone, rejected because browser tooltips are inconsistent and are not beneath fields.
2. Associate field errors with inputs via `aria-describedby` and set `aria-invalid` when applicable. Continue to use the existing top-level API error message for server failures. Alternative: a single top-level validation error, rejected because the user requested field-level feedback.
3. Navigate to the landing route on a successful API response and pass a transient success notice into the sign-in panel. Alternative: leave the completed form in place with a manual button, rejected because the requested flow redirects automatically.

## Risks / Trade-offs

- [Password policy changes server-side] → Continue to surface API errors; keep this client validation aligned with the documented 12–128-character rule.
- [A failed request loses entered values] → Preserve both fields and remain on the route so the user can retry.

## Migration Plan

Frontend-only deploy or rollback; no persistent data or API change.
