# Explicit All posts folder filter

## Why

The current folder sidebar offers an explicit Unfiled choice and treats no checked folders as all posts. Readers instead need an explicit All posts control; clearing every folder should show posts without a folder. The term Unfiled should not appear in the folder UI.

## What Changes

- Keep All posts as the default feed mode and as a separate, exclusive sidebar control.
- Let checked staff-created folders match by OR. Clearing the last selected folder switches to folderless posts; no explicit folderless checkbox appears.
- Use “No folder” only where a folder choice or missing-folder label needs text, including Create/Edit Post, post labels, and the deletion confirmation.
- Preserve the existing API's `folder=unfiled` internal query and existing deep links. No database or API contract change.

## Impact

Course feed sidebar state and URL mapping, folder labels, browser tests/screenshots, and the post-folders UI specification.
