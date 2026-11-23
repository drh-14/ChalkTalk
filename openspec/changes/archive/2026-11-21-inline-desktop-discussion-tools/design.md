## Context and approved decision

The user explicitly requests New post and Filters inline with desktop Search, and explicitly supersedes the desktop dropdown fallback with compact visible section links. Remove the redundant All courses link at every width; the existing guarded ChalkTalk logo is the home link. Mobile continues Search icon, New post icon, Filters; Search expands below and mobile sections remain a dropdown.

## Implementation

Use one desktop toolbar grid row with a shrinkable search field and existing buttons; reserve sufficient feed width on desktop so Search remains usable. Keep the existing two feed/detail columns, no filter column. Desktop header uses visible nowrap links; compact horizontal gaps/padding and readable type at narrower desktop widths, allow the course title to truncate while preserving the existing full-title tooltip/switcher. Keep notifications/avatar and all existing role-visible links/unread indicators/guards. Remove desktop overflow-to-dropdown measurement; mobile dropdown and focus behavior stay intact. No dependency or architectural change.

## Verification

Write/run RED browser geometry assertions for Search/Filters/New post one row and all six desktop sections visible on logo row at851/1024/1280/1600px. Then implement and verify GREEN, no horizontal overflow, keyboard/guard behavior, existing responsive title/content/browser flows, mobile320/390/landscape. Capture/inspect screenshots; run full web tests/typecheck/lint/format/build, sync and archive only after verification. Preserve durable history and one final PR commit, full no-mistakes final-head gate and screenshots/CI.
