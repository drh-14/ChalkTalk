## Why

Course settings currently executes removal of another member or deletion of a course as soon as the action button is clicked. These destructive actions need an explicit, accessible confirmation so an accidental click cannot immediately revoke access or begin permanent cleanup.

## What Changes

- Show an in-app confirmation naming the affected member or course before either request is sent.
- Provide distinct Cancel and destructive Confirm actions, keyboard dismissal, and predictable focus behavior.
- Keep the existing API permissions, conditional requests, and error recovery; stale destructive actions require a fresh confirmation after data refresh.
- Add browser-flow tests and screenshots for the user-visible confirmations.

## Capabilities

### Modified Capabilities

- `course-management`: Course settings require explicit confirmation for member removal and course deletion.

## Impact

Course settings frontend, its tests and browser evidence. No API, database, dependency, or authorization change.
