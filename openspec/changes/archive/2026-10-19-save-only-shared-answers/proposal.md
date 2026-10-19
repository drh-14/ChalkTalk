# Save-only shared answers

## Why

Answer changes should become visible only when an editor explicitly saves. The draft PR's per-keystroke Hocuspocus behavior would publish unfinished text and does not match that decision.

## What Changes

Replace live answer editing with independent Markdown drafts committed by an explicit Save. Followups and replies remain REST-only. A stale save preserves the draft and shows the current answer before a deliberate, version-checked Overwrite. Remove the unused live transport and binary state after a checked migration.
