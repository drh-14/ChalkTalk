## Approved scope

User approved /Users/darrenh/design-output/pr271-toolbar/planned-toolbar.png for interaction/layout only; actual UI remains style authority. Desktop plus icon uses existing mobile SVG and44px target, no text, accessible New post except archived saved-draft action keeps its existing accessible identity. Preserve all composer semantics. Keep mobile existing accessible create action.

## Implementation

Use existing button styles/icon. Border follows aria-expanded, not query. Outside pointer listener exists only for expanded mobile search, excluding its field (including Clear) and toggle; dismiss without preventDefault or focus call. Keep query, Escape field-wide, toggle and slash unchanged. No new dependencies. Header stale-delete focus repair must survive.

## Verification

Tests first RED/GREEN: desktop accessible plus44px and composer; mobile320/390 empty/populated/open/dismiss/reopen, green border tied to aria-expanded, no query clearing or outside-focus theft; Clear/input inside, Escape/toggle still work. Screenshots each scenario with mocked real browser. Full web/typecheck/lint/format/build plus full mocked browser coverage; sync/archive only after verified. Preserve history before one-commit consolidation, exact tree proof and final-head gate/CI/native screenshot attachments.
