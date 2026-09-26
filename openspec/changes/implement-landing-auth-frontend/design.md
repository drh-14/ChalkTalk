## Context

The web application currently has a single placeholder component and no routing or DOM test tooling. The existing API exposes cookie-based sessions, CSRF protection, signup verification links, and password-reset links. See `proposal.md` and the authentication API reference for product behavior.

## Goals / Non-Goals

**Goals:**

- Deliver the approved landing, public auth flows, and protected static `/home` experience.
- Keep all API calls relative to `/api/v1` and retain session/CSRF credentials only in memory.
- Make browser behavior independently testable at the auth-client, route, and rendered-app seams.

**Non-Goals:**

- Profile, password-change, email-change, account-deletion, course management, or live posts UI.
- A routing or application-state framework.
- A configurable cross-origin production API base URL.

## Decisions

### Deep browser auth client

`apps/web/src/auth` owns endpoint paths, browser credentials, JSON/error-envelope parsing, idempotency headers, and CSRF logout. UI components receive typed results and errors rather than raw `fetch` responses. This centralizes the API contract and keeps forms focused on user interaction.

### Native routing and in-memory secrets

The app uses the History API for `/`, `/verify-email`, `/reset-password`, and `/home`. Session and CSRF values live in React state only. Emailed tokens are parsed once, then removed from the visible URL with `replaceState`; local/session storage is not used. React Router is unnecessary for these four routes.

### Protected placeholder home

App startup restores the current session before rendering protected content. Authenticated visitors at `/` are redirected to `/home`; unauthenticated visitors at `/home` return to `/`. The home page is explicitly static until course/post APIs exist.

### Test tooling

Use Vitest with jsdom and React Testing Library for rendered app flows, plus mocked `fetch` tests for the auth client and pure route tests. This adds only development dependencies and tests observable behavior rather than component internals.

## Risks / Trade-offs

- Relative API URLs require the production frontend to proxy `/api` to the API. → Retain the existing local convention; add deployment configuration only when production topology requires it.
- Account creation does not issue a session. → Follow a successful account creation with login, and preserve a useful sign-in fallback if that call fails.
- URL token removal can make a manual refresh unusable. → Keep the token in active React state for the current form and show a recovery link if it is missing.

## Migration Plan

Deploy as a replacement for the placeholder web app. Roll back by serving the previous frontend build; no database or API migration is required.
