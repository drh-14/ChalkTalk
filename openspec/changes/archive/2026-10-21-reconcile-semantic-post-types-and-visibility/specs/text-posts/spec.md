## ADDED Requirements

### Requirement: Semantic post types and current visibility stay compatible
Semantic indexing, generation catch-up and semantic-only candidate expansion SHALL apply only to questions and notes, not polls. Poll search SHALL retain the existing lexical/fuzzy behavior without query embeddings when filtered to polls. Unsupported stale vectors/jobs/catch-up SHALL not expand results or make semantic health unhealthy. Private questions and notes SHALL follow current main's author-and-current-staff read rules, with the current visibility predicate applied before ranking, pagination and hasMore. Nonmembers SHALL not access results. Publishing a private post SHALL change readability through current authoritative state, while text edits retain existing revision checks. Existing notification/activity jobs, attachments, resources, live code sessions, fallback and separate-worker behavior SHALL be preserved.

#### Scenario: A private semantic match and authorized roles
- **WHEN** an author, another student, course TA, instructor or nonmember searches private semantic matches
- **THEN** only authorized current members receive them, and hidden matches do not alter other members' page boundaries or hasMore

#### Scenario: Poll eligibility and fallback
- **WHEN** polls exist or stale poll semantic artifacts are present
- **THEN** indexing and semantic-only expansion exclude them, poll lexical results remain available, and unrelated semantic health remains usable

#### Scenario: Private post becomes public
- **WHEN** an authorized current author or staff member publishes a private question or note
- **THEN** other members can find its current content without bypassing revision or visibility checks
