# Design

## Context

See proposal.md. The existing SlideViewer owns page/zoom/composer state; ResourceExtractedText owns text layout and status, and SearchablePdfView owns generation polling plus an iframe. The backend exposes immutable file IDs and protected derived URLs, but does not attest original-to-derived crop geometry.

## Goals / Non-Goals

Goals: reuse viewer rendering, generation APIs and extracted-text formatting; stabilize refresh and mobile navigation without losing composer state. Non-goals: new backend protocol, OCR generation changes, anchor remapping or annotation editing.

## Decisions

- Keep the original document loaded as anchor authority; load the derived PDF lazily through its protected view URL into the same canvas surface. Preserve page/zoom state and scroll position when changing documents. New downloads remain separate actions.
- Conservatively treat derived alignment as unverified because matching page sizes alone cannot prove CropBox/rotation equivalence. Hide overlays in copy mode and switch to original on Mark or Ask. This uses the user's approved fallback rather than introducing a geometry-attestation protocol.
- Add an embedded extracted-text mode by reusing existing status/progress/reflow/download behavior with PDF-switch controls disabled there. Catalog PDF text actions navigate to a text-panel query parameter. Non-PDF catalog behavior remains inline.
- Own generation in a cancellable viewer hook using the existing 2s/10s/16-minute bounds, explicit prepare/retry and source-file fencing. Do not automatically generate on selection alone.
- Use cancellable serial question fetches, an immediate visible/focus refresh and a 15-second visible interval. Maintain independent loading/error state and preserve stale data only for the same original file. Detect replacement before updating markers; explicit reload uses the existing draft guard.
- Keep mobile tabs mounted but hide inactive panels with CSS; desktop keeps two columns. Measure the viewer's viewport top using resize/scroll observers and adjust remaining height. Restore page after PDF tab/version switches.

## Risks / Trade-offs

- Derived copies do not show anchor markers until there is stronger alignment evidence; asking returns to original. This prevents misplaced questions.
- PDF documents consume memory; destroy viewer-only derived documents on replacement/unmount and fence async loads against obsolete selections.
- Background refresh can race file replacement; never publish a questions list whose file ID differs from the displayed original.
- Tests and automated checks are deferred at explicit user direction. Implementation remains unverified until those tasks run; no publication during this phase.

## Migration Plan

Frontend-only change on PR175; no extra migration beyond its existing 060 anchor migration. Preserve existing API shape and authorization. Reverting frontend code restores the prior UI without altering stored anchors.
