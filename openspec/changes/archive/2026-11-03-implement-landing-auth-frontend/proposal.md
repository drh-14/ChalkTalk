## Why

ChalkTalk exposes a complete browser authentication API but presents only a placeholder browser screen. A landing and authentication experience is needed so users can establish a session and reach the product's initial course-discussion surface.

## What Changes

- Add a responsive landing page with login, verified-signup, and password-recovery flows.
- Add emailed-link screens for account creation and password reset.
- Add a session-protected dummy home page with static course and post content plus sign-out.
- Add browser-facing auth, routing, and UI tests derived from the authentication API reference.
- Add DOM test tooling for React UI behavior.

## Capabilities

### New Capabilities

- `web-auth-entry`: Browser landing, authentication entry flows, and protected placeholder home navigation.

### Modified Capabilities

- None.

## Impact

- Changes `apps/web` React modules and styling.
- Adds browser-test development dependencies and Vitest DOM configuration.
- Uses existing relative `/api/v1` authentication endpoints and secure browser-cookie behavior without changing the API.
