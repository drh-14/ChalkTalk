# Tasks

## 1. API

- [x] 1.1 Accept questions and notes in the followup service's post check, keeping polls refused. Verify: the followup integration test creates and lists a note followup and gets `409 not_a_question` for a poll.
- [x] 1.2 Update the answers and followups API reference. Verify: it no longer says notes refuse followups.

## 2. Web

- [x] 2.1 Render the followup section on note detail without answer areas. Verify: a component test and a browser test show a note's followups and no answer areas.
