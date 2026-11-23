# Design

## Context and boundaries

At base 6053a32a, AppBar uses the home variant for both /home and /account. The original .app-bar.home .app-bar-inner caps width at 64rem with 1.25rem outer padding; home main content independently has a centered 64rem maximum width. Course headers use separate responsive grid rules.

Only /home changes. Use .app-bar.home:has(+ .home-shell) to target the existing DOM relationship without adding a component variant or changing React. Keep account-settings and course headers unchanged. No API, data, dependency, global theme or shared-control redesign.

## Approved header

Remove the width cap only for the home-page header; retain 20px default outer padding, green bar, 52px height, existing logo/notification/profile controls and focus behavior. Keep main content centered and narrow. Its lack of alignment with the widened header on desktop is intentional and user-approved.

## Approved home notification panel

Browser tests reproduced pre-existing panel clipping at 390px and 320px (left edge -32.8px). Keep its existing absolute positioning under the bell, right: 0 and 8px vertical gap. Constrain only the home-page panel width to min(24rem, calc(100vw - var(--space-5) - var(--space-5) - 2rem - 0.8rem)). The reserved space is the two existing gutters, 2rem profile avatar and 0.8rem account-control gap.

This preserves the bell-aligned right edge and gives a 20px left gutter on narrow screens instead of moving the panel under the profile or making it viewport-fixed. Panel widths are approximately 305px at 390px and 235px at 320px; desktop remains 384px. Existing content wraps naturally. Explicit browser assertions guard these local spacing assumptions.

## Approved course-action row

Use only .home-shell .course-actions { flex-wrap: nowrap; }. Existing flex shrinking and text wrapping retain the full Create course and Join a course labels in that order, styles, 16px horizontal padding and 12px gap. At 320px, card content has 238px available: approximately 116px and 110px wide buttons grow to 54px high with wrapped labels. At 390px and desktop, the existing 40px-high single-line appearance remains unchanged. The user explicitly approved wrapping labels rather than reducing typography or touch targets.

## Approval evidence

Actual current application components/styles with mocked API were rendered in Chromium. Mockup-only CSS injection showed each proposed change before product edits. User approval was received for all three stages. Ignored mockup evidence is under documentation/browser-screenshots/home-header-panel-mockup/ and home-course-actions-mockup/; these are distinct from final implementation screenshots.

## Specification-driven tests and evidence

The public seam is the real Chromium-rendered application with mocked API, approved by the user. Header alignment RED measured logo x=228 instead of 20. Mobile panel RED measured x=-32.8. Button-row RED at 320px measured action y positions 487 and 539. Account-header regression RED demonstrated that the shared home variant needed a narrower page-specific selector. No source-string assertions or weakened bounds checks.

Seven home/account browser cases now cover 1440/390/320px edge alignment, header/main geometry, panel anchors, no overflow, readable full labels, minimum target size, keyboard order/focus, notification/profile Escape behavior and existing labeled Create/Join forms. Existing responsive-course-ui and notification-bell-cards cases provide regression coverage. Screenshots are captured in ignored output directories and must be uploaded to the new draft PR; never commit them.

The home browser file is registered in the existing test:browser:mocked command so CI keeps running it. The local repository test suite passes without provisioning a real API/database; environment-dependent suites retain their existing skips. Database/full-stack coverage is outside this CSS change.

## Deployment and delivery

Normal web assets only; no migration. Rollback removes the three home-page style overrides. Validate and archive the OpenSpec change after implementation verification. Publish a new draft-only PR (never PR271), preserve all scoped gate fixes, ensure one final commit and verify exact-head CI. The parent owns user communication/watch; no readiness/merge action is authorized.
