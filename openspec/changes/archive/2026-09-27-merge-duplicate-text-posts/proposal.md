# Merge duplicate text posts

## Why

Confirmed duplicate questions and notes currently remain visible in the feed and search. The course needs one canonical discussion without losing old links or the ability to undo a mistaken merge.

## What changes

- Staff can confirm a same-course post as a duplicate of an active canonical post; the source text remains in storage.
- Confirmed sources disappear from ordinary lists, full-text search, and Related questions. Direct reads redirect current members to the canonical post.
- Staff have a restricted Duplicate posts view with source title, canonical title, and unmerge action.
- Confirmed sources cannot be edited or deleted until unmerged; canonicals with inbound confirmed sources cannot be deleted or merged.

## Impact

The existing post duplicate fields and API routes are reused. No dependency or migration is needed. API/database references, OpenAPI, HTTP tests, and frontend tests must reflect the changed contract.
