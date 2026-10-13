## Context

`/api/v1/users/me` already provides a versioned profile read and display-name update; `/users/me/password` and `DELETE /users/me` already enforce current-password checks. The web client exposes none of these operations. `App.tsx` owns routing, session state, and the shared top bar. Course pages already register a leave guard for unsaved drafts.

## Goals / Non-Goals

**Goals:** Reuse the established account API and error envelope; keep profile version current across account actions; preserve draft navigation guards and accessible form feedback.

**Non-Goals:** Changing email, changing backend deletion semantics, adding data export, or adding a new auth provider.

## Decisions

1. Add a shareable `/account` route and turn the existing name into a link. The route remains in the current app router so browser Back and direct navigation work. Alternative: a header popover; rejected because the three actions, especially deletion, need more space and clear focus.
2. Read `/users/me` when the page loads and retain its `ETag` for `If-Match`. After a successful name edit use the response `ETag`; after a password edit refresh the profile because the password operation returns no body. On `412`, refresh and ask the user to review before retrying. Alternative: derive `"vN"` from the session user; rejected because the profile may have changed in another tab.
3. Use separate forms for name and password. Password fields remain local to the form and clear after success. The browser confirms matching new passwords before an API call. Alternative: one combined form; rejected because the endpoints and success behavior differ.
4. Put deletion behind an inline confirmation dialog with an explanation, password input, Cancel, and a distinct Delete account action. The backend still verifies the password and handles final-instructor protection. Alternative: a single Delete button and browser confirm; rejected because the required password and consequences need visible context.
5. On name save update the app's session user; on deletion clear session state and navigate to `/`. Keep the course leave guard in the link handler. Alternative: full page reload; rejected because state changes are already centralized in `App`.

## Risks / Trade-offs

- [The account changes in another tab] → Use server `ETag`, refresh on conflict, and require review before retry.
- [A course has an unsaved draft] → Route through the existing leave guard before opening `/account`.
- [A final instructor cannot delete their account] → Display the API's `last_instructor` error without clearing session state.

## Migration Plan

Frontend only. Deploy and roll back with the web bundle; the existing API contract remains unchanged.
