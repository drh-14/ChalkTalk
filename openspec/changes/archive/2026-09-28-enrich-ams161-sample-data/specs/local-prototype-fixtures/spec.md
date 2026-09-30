## MODIFIED Requirements

### Requirement: Prototype contains realistic course discussion

On first enabled run, the step SHALL atomically create AMS161, a loggable full-name instructor, a full-name teaching assistant, and full-name mock student authors, with every non-instructor account given a discarded random credential. It SHALL seed Calculus II questions and notes written by the instructor, the teaching assistant, and students, with creation times spread from minutes to months before the seed ran. Posts SHALL carry tags; some SHALL be pinned, some SHALL be anonymous, and some questions SHALL have student or staff answers, including an endorsed student answer, while others stay unanswered. A post's last activity SHALL be its latest answer, or its creation when it has none. Three questions SHALL have similar counterparts so an instructor can find and merge them manually. No question SHALL start with a duplicate status or target.

#### Scenario: Instructor explores the prototype

- **WHEN** the fixture has been seeded and the instructor signs in with the locally configured password
- **THEN** all seeded posts appear in the ordinary feed, similar questions can be found through search, and the staff duplicate-review list is empty until an instructor merges a question

#### Scenario: Feed filters have data to show

- **WHEN** a course member filters the seeded feed by notes, pinned posts, answered or unanswered questions, TA posts, or a tag
- **THEN** each filter returns at least one seeded post, and the feed shows both recent relative times and older full dates
