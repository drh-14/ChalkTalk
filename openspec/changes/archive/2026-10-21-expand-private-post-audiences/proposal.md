## Why

The merged private-post feature gives every current TA and instructor access to every private question or note. Authors need narrower conversations with selected staff or a staff-managed group without exposing the post or its dependent content through another surface.

## What Changes

- Extend the existing class/private choice to exactly one audience: entire class, all current course staff, explicitly selected current staff, or one staff-managed private group. Only current group members may post to a group, and group access—including the author’s—ends on group exit. No instructor has a read override for a narrower audience.
- Let course staff create, rename, populate, and delete private groups. Authorization follows current course and group membership. A group referenced by a post may be renamed, but not deleted.
- Preserve the merged private-post lifecycle and apply the audience check consistently to posts and descendants, attachments, search, notifications, digests, and live sessions. Keep announcements and polls class-visible.
- Offer an audience picker and group management UI with a clear privacy preview; document API/database contracts and test public HTTP, jobs, transport, and browser flows.

## Capabilities

### New Capabilities

- `post-audiences`: Exclusive audience selection, staff-managed groups, current-member authorization, and inheritance across private-post surfaces.

### Modified Capabilities

None. Existing statistics semantics remain unchanged.

## Impact

Adds normalized group and selected-recipient storage in the next available migration (reserve `044` conceptually; confirm the actual number at implementation), extends post/group APIs and the existing private-post contract, and changes post, answer, followup, attachment, notification, digest, collaboration, and web-composer paths. Reuse the unpublished selected-staff work at `3a1bdf0` selectively rather than cherry-picking its older migration or replacing merged behavior. No new service or dependency is planned.
