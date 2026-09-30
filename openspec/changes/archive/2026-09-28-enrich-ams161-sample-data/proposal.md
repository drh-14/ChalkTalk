## Why

The AMS161 fixture seeds twelve questions, all created at the same moment, with no notes, tags, pins, answers, anonymous posts, or teaching assistant. Teammates testing the redesigned feed therefore cannot see most of it without creating data by hand: note cards, the Answered, Unanswered, Pinned, Instructor, and TA filters, tag chips, relative and full dates, and answers.

## What Changes

- The fixture adds a teaching assistant, Sam Okafor, and a fourth student, Casey Morgan. Both have discarded random passwords like the other mock students.
- It seeds a mix of questions and notes, written by the instructor, the TA, and students, created from minutes to about four months before the seed runs.
- Posts have tags. Some are pinned, two are anonymous, and some questions have student or staff answers, one student answer endorsed. A post's last activity is its latest answer.
- The three similar question pairs remain, and no post starts merged.
- The seed still runs once per database volume, so an existing local database keeps its data until its volume is reset.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-prototype-fixtures`: the realistic-discussion requirement describes the richer fixture instead of twelve questions.

## Impact

`apps/api/src/database/seed-ams161.ts`, its integration test, and the local-development section of `README.md`. No schema, API, or production change: the seed writes nothing unless `MOCK_DATA=true`.
