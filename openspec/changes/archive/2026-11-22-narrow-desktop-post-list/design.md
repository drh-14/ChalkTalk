## Context

Explicit APPLY approval covers PLAN.md and planned-after*.png in /Users/darrenh/design-output/pr271-posts-width-planned-20261122. Actual UI styling is authoritative.

## Goals / Non-Goals

**Goals:** desktop min320/preferred28.8%/max384 at16px root, full remaining detail width, live equivalent header geometry, unchanged mobile.
**Non-Goals:** change roles, guards, filtering, search, composer, card typography, icons, targets, dependencies or runtime policies.

## Decisions

Use a single inherited CSS track custom property, shared by discussion grid and an invisible, aria-hidden header geometry marker. The marker resolves percentage/rem sizing in the full-width course header, so other sections need no hardcoded JavaScript fallback. Prefer actual discussion detail.left when present. Observe relevant grid/feed and marker sizes, rebinding after content replacement; preserve shallow content mutation observation and existing title/nav/font observations. Do not observe editor text. Preserve keyed controls and fractional short-title allowance.
Tests measure rendered public UI geometry at851/1024/1280/1440/1600, selected/unselected, root-font changes, section replacement, focus, overlay bounds and mobile320/390/850. Existing two-stage fit, role/guard/search/filter/browser suites remain.

## Risks / Trade-offs

Earlier title ellipsis at851 is approved; preserve accessible complete title and selected detail. Min320 means reduction is16.7% at851, not20%; max480→384 is20%. Resize feedback must be scheduled and only changed CSS values written. Geometry marker adds no visible UI or accessibility target. Rebind disconnected observations; no editor typing remeasurement regression.

## Verification

Write geometry regression and confirm RED before product edits. Run GREEN plus affected full mocked browser suites, web tests/typecheck/lint/format/build; sync main spec and archive only after behavior verified. Preserve all histories/tree proofs before onecommit consolidation. Full isolated gate and exactheadCI, draftPR271, native current screenshots embedded in description required before delivery.

## Verified behavior

The pre-change1280px geometry test failed by92.16px. After implementation all81 affected mocked real-browser tests and630web tests pass; typecheck,lint,format,build pass with existing chunk warnings. The unchanged content-fit transition assertion now uses1000px because the approved narrower feed lets unread content still fit at1060/1024px. New tests cover851/1024/1280/1440/1600, pinned unanswered question/note titles, root-font/live-grid changes, route replacement and mobile320/390/850. Current actual screenshots are external evidence; final publication validation remains the outer owner task.
