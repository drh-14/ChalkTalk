# Proposal

## Why

The CSE 416 Piazza import exists only in the database of whoever ran it with Piazza credentials. Teammates who pull the repository cannot demo ChalkTalk with a real course.

## What Changes

- Commit a saved CSE 416 Piazza export as a demo fixture.
- When mock data is enabled, the demo seed also imports CSE 416 from that fixture, owned by the AMS161 demo instructor, so signing in as Maya Chen shows both courses.
- The seed imports CSE 416 only when it is absent, so repeated startups keep local edits. Imported people log in only when `PIAZZA_DEMO_PASSWORD` is set.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-prototype-fixtures`: the enabled demo seed also loads the CSE 416 course.

## Impact

- `database/fixtures/cse416-piazza-export.json`: real CSE 416 forum content, including names, committed to a public repository at the project owner's request.
- `apps/api/src/database/`: a CSE 416 seed step called from the mock-data entry point; the importer exports its course id derivation.
- README demo-data section. No API, schema, or UI changes.
