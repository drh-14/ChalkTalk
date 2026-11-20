## Why

Browser-native confirmations interrupt ChalkTalk's visual and keyboard experience. Internal navigation also lacks the subtle content entrance seen in production post views.

## What Changes

- Replace all in-app native confirmation prompts with one accessible ChalkTalk-styled dialog.
- Preserve cancel/confirm semantics for mutations and navigation, including unsaved edits and browser Back/Forward.
- Animate accepted internal navigation and initial ready load with the production post-content opacity entrance; skip same-page search/filter updates and reduced-motion users.

## Capabilities

### New Capabilities

- `confirmation-dialogs`: Consistent in-app confirmation and navigation guard behavior.
- `navigation-entrance`: Whole-page entrance behavior on accepted internal navigation.

### Modified Capabilities

None.

## Impact

Frontend application routing, posts, answers, threads, live sessions, styles, and browser tests. No dependency, API, or database change.
