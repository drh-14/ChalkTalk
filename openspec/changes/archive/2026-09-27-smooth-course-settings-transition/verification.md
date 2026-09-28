# Verification

- `npx vitest run apps/web/src/app/App.test.tsx`: passed (16 rendered App tests). The first navigation test failed before implementation because the Settings link performed document navigation.
- `npx vitest run --project web`: passed (68 tests across 8 files).
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build --workspace=@chalktalk/web`: passed.
- `npm run format:check`: passed.
- `openspec validate smooth-course-settings-transition --strict`: passed.
- Running Compose HTTPS smoke: `curl --fail --insecure https://localhost:5173/` returned the web HTML. Browser-visible transitions were exercised through rendered interaction tests; no separate manual visual browser check was performed.

The rendered tests cover stable shared heading identity, same-document route changes, active navigation, Back/Forward, declined draft discard (including browser Back), settings loading/error/retry inside the frame, and renaming reflected immediately in the heading.
