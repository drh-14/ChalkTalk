## ADDED Requirements

### Requirement: Optional semantic post search

A deployment MAY enable semantic search of questions and notes with an OpenAI-compatible embedding provider and optional pgvector schema. With no key, unavailable schema, provider failure, or invalid embedding response, list search SHALL retain full-text and fuzzy behavior without returning an error. Provider requests SHALL contain only bounded search text or post title/body chunks, not identities or course metadata.

Post creation, text edits, and unmerges SHALL commit even if semantic enqueue or indexing fails. A write with unavailable or failed enqueue SHALL atomically record per-post catch-up state in ordinary PostgreSQL, including when no provider key is configured. A worker SHALL drain that state in bounded work without repeatedly scanning the whole indexed corpus while idle, and SHALL clear it only after storing the current post revision. Deleted and confirmed-duplicate posts SHALL have their catch-up state removed in the same transaction as embedding cleanup. While catch-up state or a failed current-generation indexing job remains, semantic search SHALL use only the established full-text and fuzzy path. A query-provider failure SHALL do the same.

An indexing worker SHALL claim and complete only jobs for its configured embedding generation. Catch-up state SHALL be owned by a generation before indexing and SHALL be cleared only by successful revision-checked storage for that generation. No-key catch-up state MAY be unowned until a configured worker claims it. Whitespace-only fixed-width chunks of otherwise valid post text SHALL not be sent to the provider.

#### Scenario: Rolling embedding generation

- **WHEN** an old-generation worker and a new-generation worker run concurrently with new-generation catch-up work
- **THEN** the old worker cannot claim the new job or clear its catch-up state, and the new worker stores new-generation vectors before clearing it

For ordinary `q`, semantic matches MAY join the candidate set. Explicit phrase, `OR`, and negative queries SHALL keep their existing lexical meaning and SHALL not implicitly expand semantically. `semanticQuery` MAY accompany a valid `q`; it SHALL be bounded and validated, and SHALL not alter `q` boolean semantics. A request with `semanticQuery` but without `q` SHALL return `400 invalid_request`.

Within each pinned group, relevance SHALL rank full-text matches first, fuzzy-only matches second, and semantic-only matches third. Semantic similarity SHALL order only the semantic-only tier; no similarity cutoff applies initially. Chronological sorts SHALL preserve their documented ordering across all matching visible candidates. Authorization, course, filters, confirmed duplicates, pagination, and `hasMore` SHALL be applied to the complete visible union of candidates, not a truncated global vector result. Cursors SHALL bind the semantic ranking generation and reject incompatible use. Deleted and stale-revision embeddings SHALL not match.

When semantic ranking becomes unhealthy between relevance pages, a semantic cursor SHALL return `409 search_restart_required` rather than a fabricated final page. A request without that cursor SHALL return only the established lexical/fuzzy results. Invalid or mismatched cursors SHALL retain their existing `400 invalid_request` response.

#### Scenario: Lexical precedence over semantic similarity

- **WHEN** a member searches a course with full-text, fuzzy-only, and semantic-only candidate posts
- **THEN** every full-text result precedes every fuzzy-only result, and every fuzzy-only result precedes every semantic-only result within each pinned group

#### Scenario: Semantic service unavailable

- **WHEN** the key, vector schema, or provider is unavailable
- **THEN** the same request returns lexical and fuzzy results and does not fail

#### Scenario: Semantic query requires ordinary query

- **WHEN** `semanticQuery` is supplied without `q`
- **THEN** the API returns `400 invalid_request`

#### Scenario: Private and duplicate posts cannot leak through semantic search

- **WHEN** embeddings exist for posts outside the course, deleted posts, or confirmed duplicates
- **THEN** they do not affect results, pagination, or `hasMore`

#### Scenario: Stale index result is discarded

- **WHEN** a post changes while the provider computes an embedding
- **THEN** the old revision cannot be stored as an eligible embedding

#### Scenario: Enqueue fails while a write is in flight

- **WHEN** a post write obtains an update timestamp before a backfill scan passes it, and enqueue then fails before the write commits
- **THEN** the post still commits with durable catch-up state and a later worker poll indexes its current revision

#### Scenario: Indexing fails and recovers

- **WHEN** the current generation's worker job fails or a post has pending catch-up state
- **THEN** search returns only full-text and fuzzy results until successful revision-checked indexing clears the failure and catch-up state
