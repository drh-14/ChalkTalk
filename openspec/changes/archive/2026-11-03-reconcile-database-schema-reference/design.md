## Context

`documentation/database.md` records the agreed target schema. Existing ER
diagrams informed several topology choices but will be revised separately;
they are not modified by this change. Existing migrations describe an earlier
implemented subset and are also out of scope.

## Goals / Non-Goals

**Goals:**

- Make the reference explicit enough for future database, API, and diagram
  work to share one intended model.
- Preserve database-enforced integrity where the team agreed it is necessary.
- Clearly distinguish database constraints from application-enforced rules.

**Non-Goals:**

- Change a running database or create migrations.
- Update ER image/source artifacts.
- Implement triggers, RLS policies, API behavior, or application validation.

## Decisions

### Course scope is stored and cross-checked

Course-scoped descendants retain direct `course_id` values for scoped reads.
Composite foreign keys pair that value with their parent identifier, preventing
cross-course references while preserving globally useful simple IDs.

### Tags are normalized

`tags` is course-scoped and `post_tags` associates posts with tags. A tag name
is unique within its course and a post/tag pair is unique. The application
enforces that a tag and post belong to the same course; this change does not
introduce a database trigger.

### Attachments use explicit parent foreign keys

Attachments have nullable post, answer, and followup foreign keys, with an
exactly-one-parent check. This intentionally avoids a generic `parent_type` /
`parent_id` pointer so ordinary referential integrity and deletion behavior
remain available.

### Answer editors are a set, not an event history

`answer_contributors` records each unique answer/editor pair. The schema does
not retain edit-by-edit contribution events.

### Supporting product tables remain in the reference

Post views, course digest state/entries, answer collaboration documents, and
specialized collaboration tickets remain part of the target model even though
the current ER views do not show all of them.

## Risks / Trade-offs

- The reference will temporarily lead the diagrams and migrations. This is
  explicit and avoids silently deleting agreed schema capabilities.
- Repeated course IDs require composite keys and foreign keys, adding schema
  detail in exchange for data-integrity guarantees.
- Application-enforced same-course tag assignment is simpler than a trigger,
  but future write paths must retain that validation.
