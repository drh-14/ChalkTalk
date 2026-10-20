## Why

Post Edit appears above the body instead of beneath the post content. The user withdrew the accompanying native Browse/Choose File styling request; native picker appearance remains unchanged.

## What Changes

- Place question and note Edit below rendered body and existing attachments, before staff/response actions.
- Preserve existing permissions, editor behavior and rounded padded same-color Edit styling from PR54.
- Do not restyle native file inputs or recapture screenshots, as explicitly requested by the user.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: post Edit placement.

## Impact

Post view ordering, UI/component tests and existing placement evidence. No stylesheet, Resources, backend, dependencies, permission or save behavior changes.
