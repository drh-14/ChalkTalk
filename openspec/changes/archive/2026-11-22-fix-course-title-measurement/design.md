## Context

See proposal.md. The approved adaptive header is implemented and its full history is archived. Custody maintenance returned the unchanged local head6fad8e1c to supported gate_ready. Runtime627a remains separately owned; do not start the full gate until route readiness is reported.

## Goals / Non-Goals

**Goals:** avoid fractional text clipping and preserve natural selector sizing, pane-aligned/adjacent stages, fonts and focus.

**Non-Goals:** redesign the header, add a title cap, change mobile navigation or alter gate/runtime configuration.

## Decisions

- Add a one-CSS-pixel rounding guard to the integer scrollWidth intrinsic-title measurement before the existing available-space clamp. This covers subpixel rounding without a fixed width or typography change; long names remain bounded by available space.
- Compare rendered text range width with its actual fractional content-box width in real Chromium, not integer scrollWidth/clientWidth equality. Existing short-title compactness and nav geometry assertions remain.
- Return valid empty followup data/meta in the screenshot fixture and wait for settled followup UI. This fixes mock correctness only, not product followup behavior.

## Risks / Trade-offs

- Small intrinsic allowance → retain all wide/constrained geometry, content-change, editor, breakpoint-focus and mobile regressions.
- New screenshots must reflect the repaired actual source, not the isolated candidate → recapture only after GREEN and label exact source head/tree truthfully; gate remains incomplete until full validation.

## Verification and delivery

The repository regression failed with63.84375px text versus63.6px available content before the correction. After the correction all67 focused real-browser tests and630web unit tests pass, alongside typecheck, lint, formatting and build. Existing build chunk warnings remain. Actual short-title and selected-detail screenshots were visually inspected and no longer show unnecessary ellipsis or mock-response warnings.

Delivery remains pending: preserve all full-history archives/bundles/exact-tree proofs, coordinate any private lane CAS with its assigned custody owner, consolidate exactly one scoped commit, and wait for isolated runtime route readiness before a fresh full gate. No repeat of known failed shared-notify runs. Upload only current validated final-head actual screenshots directly into the draft PR description with native GitHub attachment URLs, preserving gate attestation.
