# Start AMS161 posts unmerged

## Why

The AMS161 prototype is meant to demonstrate an instructor finding and merging similar questions. Pre-confirming three duplicates hides them from the ordinary feed and leaves nothing for the instructor to merge.

## What changes

- Seed all twelve Calculus II questions as ordinary visible posts, with three pairs of similar questions.
- Start the staff duplicate-review list empty; leave merges to the instructor.
- Keep the existing local-only switch, one-time marker, accounts, transaction, and Compose order.

## Impact

Only fresh local fixtures change. Existing seeded databases are left untouched by the one-shot marker. No migration or API contract change is required.
