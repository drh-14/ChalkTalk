## Why

The database reference and ER diagrams express different schema ideas. The
project has now agreed on a target schema for the reference: use the useful
topology from the ER diagrams while retaining agreed physical integrity and
supporting-table decisions. Recording that agreement in one reviewed document
prevents later API and migration work from guessing at the model.

## What Changes

- Reconcile `documentation/database.md` with the agreed target schema.
- Document normalized tags, course-scoped composite foreign keys, explicit
  attachment parents, composite operational keys, and the set-of-editors
  model for answers.
- Preserve post views, course digests, answer collaboration, and specialized
  collaboration tickets as supporting tables.

## Capabilities

### New Capabilities

- `database-schema-reference`: A reviewed, implementation-independent target
  schema reference for ChalkTalk.

### Modified Capabilities

- None.

## Impact

- Changes `documentation/database.md` only.
- Does not change ER diagrams, SQL migrations, application code, APIs, or
  deployed database behavior. Diagram and migration reconciliation are
  follow-on changes.
