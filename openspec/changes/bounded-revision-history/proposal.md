# Bounded revision history reads

## Why

Unbounded snapshot lists can load and return an entire large revision trail for a single request. Single-revision and comparison reads also load that trail before selecting their targets.

## What changes

- Page history metadata in stable oldest-to-newest order, 50 records at a time.
- Fetch full text only for one selected revision or the two compared revisions.
- Load additional pages and selected text on demand in the discussion UI.
- Preserve visibility, anonymity, restore, and deletion behavior.
