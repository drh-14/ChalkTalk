## Why

Course-post search currently uses PostgreSQL English full-text search. It handles inflection and the documented web-search operators, but a misspelled word can hide an otherwise relevant post. The project already identifies fuzzy post search as a goal; this change adds it without introducing semantic search or a separate search service.

## What Changes

- For ordinary search text, include full-text and fuzzy matches from post titles and bodies in one course-scoped result set. For `sort=relevance`, keep full-text matches ahead of fuzzy-only matches within each pinned group, use fuzzy similarity to order eligible results within those groups, and favor title matches over body matches.
- Apply fuzzy matching only to ordinary query terms with at least three searchable characters.
- Preserve existing quoted-phrase, `OR`, and excluded-term behavior. Queries using those operators continue through the existing full-text search path.
- Keep all existing filters, visibility rules, pinned-first ordering, other sort choices, and complete cursor pagination. Ordinary feed queries can receive fuzzy matches. The composer currently sends multi-term queries joined by `OR`, so those Related questions requests remain full-text-only under the operator rule.
- Add PostgreSQL `pg_trgm` support and trigram indexes for active post titles and bodies. Verify extension availability in every deployment before enabling the new search path.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `text-posts`: ordinary course-post queries gain fuzzy title and body matches; relevance ranking prioritizes full-text matches, uses fuzzy evidence within match groups, and preserves operator queries and pagination.

## Impact

- PostgreSQL schema and migration gain `pg_trgm` and title/body trigram indexes; no post data backfill is needed.
- The posts list service changes candidate retrieval and relevance ranking. The URL, request parameters, response shape, and non-search defaults remain the same.
- The web client does not change. Ordinary feed queries can receive fuzzy matches; composer-generated `OR` queries remain full-text-only and unchanged.
- The API reference, OpenAPI description, and affected OpenSpec requirements will need to describe the broadened ordinary-query behavior.
- Search query cost, index storage, and write amplification increase, especially for bodies of up to 100,000 characters. No embedding provider, background worker, or additional service is introduced.
