## Why

Opening a website or attached file currently replaces the ChalkTalk tab in several views, interrupting the user's place in the app.

## What Changes

- Open external website links and file links in a separate tab with safe opener attributes.
- Keep ordinary in-app navigation in the current tab.

## Capabilities

### New Capabilities

- `external-link-navigation`: Consistent browser-tab behavior for links that leave the current app view.

### Modified Capabilities

None.

## Impact

Frontend link rendering in discussion content, attachments, threads, course information, and course resources. No API or dependency changes.
