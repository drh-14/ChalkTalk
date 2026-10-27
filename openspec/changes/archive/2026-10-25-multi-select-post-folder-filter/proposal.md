# Multi-select post-folder filter

## Why

Readers need to view posts from several staff-managed folders, including Unfiled, in one feed without changing the one-folder-per-post model.

## What Changes

- Allow repeated `folder` query parameters; selected values combine with OR and other feed filters with AND.
- Show accessible folder checkboxes in the left sidebar. No selection shows all posts.
- Preserve selected folders in feed links and cursor pagination.

## Impact

Post listing API, URL state, course feed sidebar, tests, and API documentation. No schema migration.
