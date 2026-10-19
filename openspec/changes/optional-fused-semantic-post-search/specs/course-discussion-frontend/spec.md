## ADDED Requirements

### Requirement: Related questions search preserves query meaning

For a draft question, Related questions SHALL continue sending its existing bounded lexical `OR` expression as `q`, and SHALL additionally send a bounded natural-language `semanticQuery` derived from the title and body sample. It SHALL remain useful when semantic search is disabled, and SHALL not send either query for notes.

#### Scenario: A draft question suggests semantically related posts

- **WHEN** a member types a question title and body
- **THEN** the debounced request sends `q` and `semanticQuery` separately while retaining the same result limit and cancellation behavior

### Requirement: Restart stale semantic pagination

The course post feed SHALL restart from page one after `409 search_restart_required` on a semantic relevance cursor, preserving the active query, sort, and filters. It SHALL replace the stale page rather than append duplicates or show an empty final page.

#### Scenario: Semantic search becomes unhealthy while loading more

- **WHEN** a member loads another page and the API rejects its semantic cursor with `search_restart_required`
- **THEN** the feed requests page one without a cursor using the same query, sort, and filters and displays the fresh lexical/fuzzy results
