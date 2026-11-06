# Proposal

## Why

One imported course makes the demo feel narrow. A second real class, from a different semester and subject, shows that the Piazza import works beyond the course it was first built for, and gives teammates more realistic content to demo.

## What Changes

- Commit a saved export of CSE 214-01 Data Structures (Fall 2024, an inactive Piazza class with 102 posts) as a second demo fixture.
- The demo seed imports every committed Piazza fixture (CSE 416, then CSE 214) under the demo instructor, each only while absent, and reports each course's result.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-prototype-fixtures`: the demo seed loads every committed Piazza course, not only CSE 416.

## Impact

- `database/fixtures/cse214-piazza-export.json`: real CSE 214 forum content, including names, in a public repository at the project owner's request.
- `apps/api/src/database/seed-piazza-courses.ts` (renamed from `seed-cse416.ts`) and its integration test; README demo-data section. No API, schema, or UI changes.
