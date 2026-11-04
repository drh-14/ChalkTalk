## Context

Course settings already implements conditional membership and course deletion, shared mutation error handling, and a retry button. Account deletion uses an in-app `role="dialog"` with focus management and matching CSS. No server contract needs to change.

## Goals / Non-Goals

**Goals:** Intercept the two instructor destructive actions before any request, retain current API behavior, and make the confirmation keyboard-accessible and browser-testable.

**Non-Goals:** Confirm other course actions such as Leave course or Archive course; change authorization, deletion jobs, or membership APIs.

## Decisions

- Keep one course-settings confirmation state tagged as member removal or course deletion. Render a small in-app dialog styled like the account deletion dialog instead of a native browser confirm, as approved by the user.
- Store the initiating element for focus restoration. Focus Cancel when opening; trap Tab, allow Escape when idle, and disable dismissal while a request is pending. Name the entity in the dialog and use action-specific labels.
- Keep server requests in the current handlers. Button clicks only open confirmation; the dialog Confirm invokes the handler. A `version_conflict` closes the dialog, refreshes data, and changes the existing Retry callback to reopen a confirmation with the refreshed entity. Other request failures leave the dialog open for an explicit retry.
- Test with component tests first, then mocked-API Playwright flows and screenshots. No new dependency.

## Risks / Trade-offs

- [Roster changed after confirmation opened] → The conditional request still protects against stale data; a conflict refreshes and requires reconfirmation.
- [Focus escapes the dialog] → Focus Cancel on open and trap Tab/Escape with browser tests.
- [The entity disappears during refresh] → Do not reopen a confirmation for an absent member or a course already deleting; show the refreshed state instead.
