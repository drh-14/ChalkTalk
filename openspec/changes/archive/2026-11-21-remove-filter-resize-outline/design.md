## Context

The handle uses the application yellow focus token through :focus-visible. Pointer-down focuses the handle, so this may be visible during drag.

## Goals / Non-Goals

Remove the handle outline only; keep original arrow toggle, other app outlines, keyboard semantics and mobile touch.

## Decisions

Use outline:none on the handle (including focus-visible), retaining existing tint. Do not invent a replacement yellow treatment.

## Risks / Trade-offs

Keyboard users lose this outline by explicit user request; accessible separator values and keyboard operation remain.

## Verification

Browser assertions exercise pointer and keyboard focus at desktop/mobile sizes and confirm no outline while resizing still works.
