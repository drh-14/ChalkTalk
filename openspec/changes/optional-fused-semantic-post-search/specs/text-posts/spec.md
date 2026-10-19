## ADDED Requirements

### Requirement: Optional semantic post search

A deployment MAY enable semantic search of questions and notes with an OpenAI-compatible embedding provider and optional pgvector schema. With no key, unavailable schema, provider failure, or invalid embedding response, list search SHALL retain full-text and fuzzy behavior without returning an error. Provider requests SHALL contain only bounded search text or post title/body chunks, not identities or course metadata.

For ordinary `q`, semantic matches MAY join the candidate set. Explicit phrase, `OR`, and negative queries SHALL keep their existing lexical meaning and SHALL not implicitly expand semantically. `semanticQuery` MAY accompany a valid `q`; it SHALL be bounded and validated, and SHALL not alter `q` boolean semantics. A request with `semanticQuery` but without `q` SHALL return `400 invalid_request`.

Within each pinned group, relevance SHALL rank full-text matches first, fuzzy-only matches second, and semantic-only matches third. Semantic similarity SHALL order only the semantic-only tier; no similarity cutoff applies initially. Chronological sorts SHALL preserve their documented ordering across all matching visible candidates. Authorization, course, filters, confirmed duplicates, pagination, and `hasMore` SHALL be applied to the complete visible union of candidates, not a truncated global vector result. Cursors SHALL bind the semantic ranking generation and reject incompatible use. Deleted and stale-revision embeddings SHALL not match.

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
