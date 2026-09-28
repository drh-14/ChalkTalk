## Why

Course members can use the text-post API, but the browser course page has no discussion interface. Its existing member and administration controls occupy the page, while the home-page discussion card is still placeholder content. Members need a course-focused way to discover, search, read, and create question and note posts.

## What Changes

- Make the course page a discussion-first split view: rectangular post cards with title and body excerpt on the left, selected post detail on the right, and a create control and search field above the feed.
- Add shareable post detail URLs, URL-backed submitted search with relevance ordering, and cursor-based pagination with retry and stale-response protection.
- Add a question/note composer using the existing JSON posts API, session credentials, CSRF token, and idempotency key. Enforce the API's 200-character title and 100,000-character body limits.
- While composing a question, show up to 10 course-scoped Related questions below the draft after a short debounce. Use the full title's searchable words and bounded recent body words in the existing lexical search, and let members open a suggestion without losing their draft.
- Move existing member and course administration controls to a Course settings route without removing their functionality.
- Render post detail Markdown safely and add responsive, keyboard-accessible interactions.
- Add rendered React interaction tests for the composer and suggestions, plus PostgreSQL-backed HTTP search examples, including `A cutoff` matching `Cutoffs for the course`.

## Non-Goals

- Polls, voting, attachments, answers, post editing/deletion controls, or a cross-course home feed.
- Changing the API search engine or promising fuzzy/semantic matching beyond PostgreSQL English full-text search.

## Capabilities

### New Capabilities

- `course-discussion-frontend`: Course-scoped question/note feed, search, creation, detail, and navigation.

### Modified Capabilities

- None. Existing course management operations remain available through Course settings.

## Impact

- Changes the web course routes, course view, browser posts client, UI styles, and tests.
- Adds `react-markdown` as the only new runtime dependency, with raw HTML disabled.
- Adds specification-derived PostgreSQL HTTP cases for existing full-text behavior; no posts API contract or database migration change is planned.
- This branch is based on the posts API branch so that API PR #17 stays separate from this frontend work.
