## Context

See proposal.md. Approved visuals are `/Users/darrenh/design-output/pr271-header-two-stage-20261122/*.png`. The source UI, not mockup typography drift, remains styling authority. Custody was returned at 400b0f4c after an outer process-verification failure, not a successful gate.

## Goals / Non-Goals

**Goals:** size from actual rendered navigation/account content; preserve existing keyed controls and focus across breakpoints.

**Non-Goals:** change mobile layout, labels, roles, navigation guards, filtering, search, composer behavior, dependencies, or process verification.

## Decisions

- Retain the existing component tree. A local layout effect measures the header and actual detail boundary, and sets only sizing/spacing CSS properties. Observe relevant rendered sizes/content and font readiness; clean up observers/listeners.
- Use the natural nonwrapping navigation width and rendered account controls. Aligned mode is available only if those controls fit right of the detail boundary with existing gaps. Otherwise adjacent mode uses the existing selector/navigation gap. Title has only the available maximum, never a fixed title cap.
- Discussion selected and unselected states use the same actual pane boundary. Other course sections retain the equivalent discussion split geometry so navigation does not jump merely by choosing another section.
- Desktop/mobile threshold remains 850px for the existing dropdown, but the desktop alignment stage is content-fit, not a new viewport breakpoint. Recompute on width, font, title, role/unread content changes without remounting controls or stealing focus.
- Browser public seam is the real App with mocked API responses. Observe geometry, overflow, full-title focus, live content changes and guarded navigation rather than source tokens.

## Risks / Trade-offs

- Measurement feedback loops → observe stable intrinsic elements and change CSS values only when different.
- Initial fonts and async content → recompute on font readiness and relevant mutations/resize; use layout effect before paint where possible.
- Narrow desktop titles truncate more → retain complete text on existing focus/hover tooltip and switcher title.
- Existing process-completion failure → fresh full gate required, without analyzer changes or bypass.

## Verification and delivery

The wide short-name regression failed by 168.8125px before implementation and passed after. All 63 focused real-browser tests pass (header geometry/content-fit, mobile dropdown, Filters, search/composer, navigation guards and focus); 630 web tests, typecheck, lint, format and build pass. Build retains existing chunk-size warnings. Screenshots are external ignored evidence, not committed assets.

After behavioral verification, preserve all pipeline fix history and exact-tree proofs before consolidating one commit, then run a fresh full no-mistakes gate and exact-head CI. The previous process-verification failure is not a gate pass and cannot be bypassed. Keep PR271 draft; embed current final-head actual-UI screenshots through native GitHub attachment URLs directly in the concise PR description, replacing obsolete evidence and claims. These delivery requirements remain pending until independently verified.
