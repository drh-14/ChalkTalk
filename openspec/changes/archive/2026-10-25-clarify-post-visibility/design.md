## Context

Main already implements author-plus-current-staff private posts with `private: true`, a `course|staff` composer state, public-only polls/announcements, and private-to-public publishing. PR #78's selected-staff/group expansion was never deployed and will not be retained.

## Goals / Non-Goals

**Goals:** Clarify visibility before publication without changing access semantics.

**Non-Goals:** New audience modes, API or database changes, private polls/announcements, public-to-private conversion.

## Decisions

- Keep the internal `course|staff` state and existing API mapping. Change only the accessible label and option descriptions, minimizing behavioral risk. Alternative: introduce a new `public|private` state and mapper, but this adds unnecessary translation.
- Rebuild PR #78 from current main rather than reverse its large unshipped schema/API delta. Preserve the old SHA in a backup ref before rewriting the same draft PR branch.

## Risks / Trade-offs

- [Existing tests locate the old label] → Update tests first, observe red, then implement and run the affected browser path.
- [Remote PR branch may change during rewrite] → Compare its remote SHA immediately before a lease-protected push; do not overwrite a changed head.
