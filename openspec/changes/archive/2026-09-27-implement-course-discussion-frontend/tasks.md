## 1. Contract and browser client

- [x] 1.1 Validate this OpenSpec proposal, behavior spec, and design before application code.
- [x] 1.2 Write failing route tests for discussion, selected-post, and settings URLs, including Back/Forward and `q` restoration; implement route and app wiring.
- [x] 1.3 Write failing browser-client tests for list/search/cursor, detail, and JSON creation with credentials, CSRF, and idempotency; implement the posts client.

## 2. Discussion experience

- [x] 2.1 Write failing rendered tests for post cards, loading/empty/error states, cursor append/deduplication, later-page retry, and stale query/course responses; implement the feed.
- [x] 2.2 Write failing rendered tests for submitted search syntax, URL encoding, explicit relevance sort, pagination reset, and server-order display; implement search controls.
- [x] 2.3 Write failing rendered tests for question/note creation, 200/100,000-character field limits, draft retention, pending state, idempotency retry, and created-post navigation; implement the composer.
- [x] 2.4 Write failing rendered tests for debounced Related questions after title and body edits, full-title token coverage, bounded body sampling and `q <= 500`, question-only relevance requests with `limit=10`, result order and cap, stale-response isolation, scrollable panel, pointer/keyboard/touch dismissal, and safe new-tab links that preserve the draft; implement suggestions.
- [x] 2.5 Write failing rendered tests for direct detail, viewer-projected author, tombstone/404/course-mismatch states, and hostile Markdown; add `react-markdown` without raw HTML support and implement detail rendering.
- [x] 2.6 Move existing member and course-management controls to Course settings, preserving behavior tests; add responsive split/narrow layout, accessible names, keyboard focus, and narrow-screen Back to posts navigation.

## 3. Real search and validation

- [x] 3.1 Write failing PostgreSQL-backed HTTP cases for `A cutoff` finding `Cutoffs for the course`, a body-only match, a quoted phrase, and an excluded term; confirm expected red/green behavior or document already-green API behavior without changing search semantics.
- [x] 3.2 Run focused and full web/API tests, formatting, lint, typecheck, build, strict OpenSpec validation, and relevant browser/Compose smoke checks.
- [x] 3.3 Record results and limitations; archive the OpenSpec change only after implementation and verification are complete.
