## ADDED Requirements

### Requirement: Related questions search preserves query meaning

For a draft question, Related questions SHALL continue sending its existing bounded lexical `OR` expression as `q`, and SHALL additionally send a bounded natural-language `semanticQuery` derived from the title and body sample. It SHALL remain useful when semantic search is disabled, and SHALL not send either query for notes.

#### Scenario: A draft question suggests semantically related posts

- **WHEN** a member types a question title and body
- **THEN** the debounced request sends `q` and `semanticQuery` separately while retaining the same result limit and cancellation behavior
