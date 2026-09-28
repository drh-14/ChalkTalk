## MODIFIED Requirements

### Requirement: Prototype contains realistic course discussion

On first enabled run, the step SHALL atomically create AMS161, a loggable full-name instructor, three full-name mock student authors with discarded random credentials, and twelve ordinary Calculus II questions. Three questions SHALL have similar counterparts so an instructor can find and merge them manually. No question SHALL start with a duplicate status or target.

#### Scenario: Instructor explores the prototype

- **WHEN** the fixture has been seeded and the instructor signs in with the locally configured password
- **THEN** all twelve questions appear in the ordinary feed, similar questions can be found through search, and the staff duplicate-review list is empty until an instructor merges a question
