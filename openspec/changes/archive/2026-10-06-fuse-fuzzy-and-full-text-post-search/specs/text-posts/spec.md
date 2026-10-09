## ADDED Requirements

### Requirement: Ordinary text search fuses full-text and fuzzy post matches

Course lists SHALL support ordinary `q` searches across post titles and bodies using the union of English full-text matches and PostgreSQL trigram word-similarity matches. Fuzzy matching SHALL require at least three searchable characters. Exact full-text matches SHALL precede fuzzy-only matches within each pinned group for `sort=relevance`; fuzzy score SHALL influence ordering within each group, with title matches favored over body matches. Quoted phrases, `OR`, and excluded-term queries SHALL retain the existing full-text-only matching and ranking behavior. Other sorts SHALL include the same complete ordinary-query match set and use their existing ordering. Course membership, deleted and confirmed-duplicate exclusions, viewer-aware author filters, other list filters, pinned-first ordering, and cursor pagination SHALL apply to the complete match set before pagination. Cursors SHALL be bound to course, viewer, sort, filters, and the relevance ranking version.

#### Scenario: A typo matches a title or body

- **WHEN** a member searches ordinary text with at least three searchable characters and the term is misspelled in a visible post title or body
- **THEN** the post is included even if English full-text search alone does not match it

#### Scenario: Exact and fuzzy matches share a result set

- **WHEN** an ordinary query has exact full-text matches and fuzzy-only matches
- **THEN** all eligible matches can be paged without gaps, exact matches precede fuzzy-only matches within each pinned group, and title similarity is favored over body similarity

#### Scenario: Operator syntax retains full-text semantics

- **WHEN** a query contains a quoted phrase, `OR`, or an excluded term
- **THEN** only the existing English full-text matching and relevance rules apply

#### Scenario: A short query cannot fuzzy match

- **WHEN** a query has fewer than three searchable characters
- **THEN** it uses full-text search without fuzzy expansion

#### Scenario: Hidden matches cannot influence a search page

- **WHEN** a fuzzy match is deleted, a confirmed duplicate, in another course, or excluded by a viewer-aware filter
- **THEN** it is absent from the response and does not affect ranking or `hasMore`
