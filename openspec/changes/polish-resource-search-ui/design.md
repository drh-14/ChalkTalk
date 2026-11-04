# Design

## Context

See proposal.md. Existing search sits after the instructor management block at y=1236px desktop and y=1786px mobile. Its 27px native input differs from the ~42px discussion search. Several existing resource buttons/selects also retain native styling.

## Goals / Non-Goals

Apply the existing design language only within Resources. Preserve the resource catalog's permissions, mutation logic, draft state, query debouncing, plain-text rendering and file downloads. No global theme changes or new dependencies.

## Decisions

- Reuse the global `search-field` and `search-clear` treatments inside a resource-specific labeled wrapper. Keep an input ref so clearing restores focus. A separate component would add a new abstraction for a small markup reuse.
- Set the resource input's minimum height explicitly to 2.6rem and retain normal input font weight with a resource-specific selector. Linux CI measured 39.8px without a minimum because default line boxes vary with fonts; preserve the >=40px browser assertion rather than relaxing it.
- Move search markup before the management block; keep creation forms mounted but hidden during active search so results directly follow search and keyboard users cannot enter unrelated forms. Clearing restores creation drafts along with existing catalog editors. Do not introduce collapsible creation tools or new interaction models.
- Apply shared tokens to resource inputs/selects and explicit existing button classes to bare actions, keeping destructive confirmations and disabled behavior. Avoid styling all buttons globally.
- Use neutral text/background for pending extraction and attention colors for unavailable contents, with text in both cases. Use the existing danger token and soft surface for error notices. No icon-only indicators.

## Risks / Trade-offs

- Shared search selectors could override resource input styling: exclude search from generic input styling and test computed size/focus.
- DOM movement could reset drafts or change tab order: move only the stateless search markup, retain editor components, and exercise search/clear with open edits in Chromium.
- Long labels could overflow on mobile: allow wrapping and keep minimum widths at zero; verify instructor and student scenarios at 390px.

## Migration Plan

Deploy normal web assets; no data migration. Roll back the scoped markup/CSS if needed.
