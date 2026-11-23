## Why

The user approved a source-style toolbar mockup to reduce desktop New post clutter and make mobile search open state explicit.

## What Changes

- Desktop New post becomes a 44px plus icon with accessible name New post; preserve composer, loading/deleting disabled and archived saved-draft behavior. Desktop Search unchanged.
- Mobile Search has a green border exactly while its field is open, including empty query. Outside pointer hides the field without clearing query or moving focus; input/clear remain inside. Preserve Escape/toggle/slash and breakpoint behavior.
- No yellow treatment, dependencies, APIs or other UX changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: toolbar icon and explicit mobile search state.

## Impact

Discussion view, scoped CSS and observable tests. Same PR271; preserve all prior repairs and draft/single-commit/final-head gate delivery obligations.
