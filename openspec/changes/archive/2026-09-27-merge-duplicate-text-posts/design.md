# Design

The existing `posts.duplicate_status` and `duplicate_of_post_id` fields represent merge state. Confirmation is a reversible transition to `confirmed`, not a soft delete: title and body remain in the row. No extra table is required.

The post service applies course membership before returning a `303` to the canonical API URL. The redirect uses `Cache-Control: private, no-store`, and contains no source data. Normal list/search excludes confirmed rows at the SQL predicate before ranking and pagination. The staff-only `duplicateStatus=confirmed` list projects only source title, canonical title, IDs, type, and version. PATCH confirmation returns a minimal canonical reference. Unmerge restores normal projection and listing.

Updates and deletions acquire a course-scoped transaction advisory lock before row locks, serializing merge transitions with canonical deletion/re-merging. A confirmed inbound reference blocks canonical deletion or merge. Targets must be active and unmerged in the same course. Staff review uses the existing course-membership API to reveal controls; the API independently enforces staff authorization.

The discussion page resolves a merged URL by following the API redirect and navigating the SPA to the canonical route. Staff choose a canonical target through existing course search; the server remains authoritative for target validation. Related questions need no special frontend filter because their search uses the same list endpoint.
