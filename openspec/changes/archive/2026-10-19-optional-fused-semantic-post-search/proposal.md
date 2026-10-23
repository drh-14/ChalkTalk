## Why

Course post search currently combines full-text and fuzzy matching but misses semantically related wording. The question composer’s Related questions panel uses explicit `OR`, so that syntax cannot be repurposed without changing its meaning.

## What Changes

- Add optional, deployment-configured OpenAI-compatible embeddings using a server-side key, URL, and model. Without the key or optional pgvector schema, preserve existing search behavior.
- Index bounded chunks of question and note text asynchronously through the existing worker, with revision-checked persistence and backfill.
- Fuse visible semantic candidates after full-text and fuzzy matches for relevance sorting, preserving filters, authorization, duplicate handling, pinned-first ordering, cursor safety, and chronological sorts.
- Add a bounded `semanticQuery` companion to `q` so Related questions can use semantic matching without changing explicit `OR` semantics.

## Capabilities

### Modified Capabilities

- `text-posts`: optional semantic post-search, indexing, and search pagination.
- `course-discussion-frontend`: Related questions sends a natural-language semantic query alongside its existing `OR` query.

## Impact

API post list, post write lifecycle, job worker, optional pgvector schema, embedding configuration/provider adapter, Related questions client, API/DB references, and tests. Hosted provider receives course-private post text and search queries but no identity metadata. No user-level BYOK or resource search.
