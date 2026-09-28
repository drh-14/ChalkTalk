# Verification

- Test-first slices confirmed failures before analyzer and editor behavior were added. Pure math analysis tests cover source offsets, valid and rejected formulas, escaped dollars, code, and incomplete expressions.
- Composer tests cover inline and block widgets, pointer and keyboard source reveal, intersecting selection, invalid-to-valid transition, toolbar insertion, raw post submission, clipboard/paste/undo, stale worker results, worker failure, and KaTeX DOM-render failure.
- `npm test`: 151 passed, 83 skipped because database integration services were not configured in this shell.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `openspec validate render-math-inside-post-editor --strict`: passed. Vite reported its existing large-chunk warning.
- Temporary Chromium smoke: valid inline and block formulas render in the editor; arrow-key and pointer activation reveal source; invalid complete math remains underlined and incomplete math neutral; IME input inside revealed source persists; 390px layout has no horizontal overflow; publishing sends raw `$x^2$`; no page errors.
- No API, database, or dependency changes were made.
