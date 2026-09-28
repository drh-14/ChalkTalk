# Staff duplicate review detail

## Why

The staff Duplicate posts list shows only source and canonical titles. The right pane currently follows the ordinary post URL, which redirects confirmed duplicates to their canonical post, so staff cannot inspect the retained source before unmerging it.

## What changes

- Add a staff-only read of an active confirmed duplicate's full retained post projection, with ETag and no-store caching.
- Selecting a full-card duplicate in the left review list loads its source in the right pane, with a canonical link and unmerge action there.
- Keep ordinary duplicate URLs redirecting and the review list summary-only.

## Impact

No migration or new dependency. The post API reference, OpenAPI contract, frontend, and API/UI tests change.
