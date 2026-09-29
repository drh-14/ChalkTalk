## Automated checks

- `openspec validate render-formatted-post-list-previews --strict`: passed.
- Added feed and Related questions behavior tests, confirmed both failed on plain-text excerpts and passed after implementation.
- Added image safety assertions, confirmed both failed when previews loaded image elements and passed after showing alt text instead.
- `npx vitest run apps/web/src/posts/views.test.tsx apps/web/src/posts/PostBody.test.tsx`: 64 tests passed.
- `npm run build --workspace=@chalktalk/web`: passed.
- `npm run lint -- --quiet`: passed.
- `npx prettier --check apps/web/src/posts/views.tsx apps/web/src/posts/PostBody.tsx apps/web/src/posts/views.test.tsx apps/web/src/styles.css`: passed after formatting.

## Browser check

Automated Chromium flows with mocked API responses passed on desktop and mobile widths after the compact-height adjustment. Three feed cards with varied body lengths each measured 7.5rem high; Related questions entries each measured 6rem high. Bold text and inline KaTeX rendered, link and image labels remained inert, keyboard navigation worked, and there were no external preview image requests or browser page errors. The compact cards fade and truncate display math at the preview edge as specified; full content remains available in post detail. Refreshed desktop and mobile screenshots were inspected visually.

Screenshots are in `.github/pr-screenshots/rendered-previews/`:

- `feed-card-desktop.png`
- `feed-card-mobile.png`
- `related-questions-desktop.png`
- `related-questions-mobile.png`
- `feed-card-keyboard-navigation.png`
