## Context
Real Chromium computed a native file-selector-button margin-inline-end of 4px on the current Resources implementation.

## Goals / Non-Goals
Increase that adjacent-text gap by 10% to 4.4px. Preserve primary visual styling, native picker and upload behavior. Do not change Upload file/Add link controls or redesign layout.

## Decisions
Use logical margin-inline-end only on the existing Resources native pseudo-element. Verify empty selection and a long selected filename at desktop/mobile widths without horizontal overflow.

## Risks / Trade-offs
The 0.4px increase is intentionally subtle; explicit computed-style assertions verify it independently of screenshot scaling.
