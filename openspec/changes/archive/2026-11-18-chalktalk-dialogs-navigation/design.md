## Context

See proposal.md and dated design records in `openspec/changes/archive/2026-11-18-chalktalk-dialogs-navigation/2026-11-18-chalktalk-confirmation-dialogs.md` and `openspec/changes/archive/2026-11-18-chalktalk-dialogs-navigation/2026-11-18-internal-navigation-page-entrance.md`.

## Decisions

- A shared React confirmation provider returns `Promise<boolean>`; action owners keep mutation and navigation ownership. Navigation guards become asynchronous and defer only one intent.
- The stable app root uses the Web Animations API for the production `content-appear` opacity 0→1, 160 ms, ease effect. Accepted route events trigger it, not raw URL changes; same-page search/filter replacements do not.
- Do not introduce a UI or animation dependency, remount route state, or replace browser-controlled tab-close prompts.

## Risks / Trade-offs

- Async navigation requires coordinated call-site changes; tests must cover cancellation, Back/Forward, and pending saves.
- Download and network rendering remains independent of these UI effects.
