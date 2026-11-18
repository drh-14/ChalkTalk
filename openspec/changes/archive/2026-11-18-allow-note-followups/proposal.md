# Proposal

## Why

Piazza lets members hold followup discussions on notes, not just questions. Imported Piazza notes already carry those followups in the database, for example a course note where the instructor answers two students, but ChalkTalk refuses followups on notes and the note page never shows them. The imported discussions are invisible and the notes cannot be discussed.

## What Changes

- The followup API accepts and lists followups and replies on notes as well as questions. Polls still return `not_a_question`.
- A note's detail page shows the followup discussion section: the count, the compose prompt, roots and replies. Notes still have no student or instructor answer areas.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `question-followups`: followups apply to questions and notes.
- `course-discussion-frontend`: note detail shows followup discussions.

## Impact

- **API:** one type check in the followup service; existing routes, payloads and errors are unchanged apart from notes being accepted.
- **Web:** the post detail renders followups for notes, without answers.
- **Docs:** the answers and followups API reference.
- **Database:** none. Imported note followups already exist.
