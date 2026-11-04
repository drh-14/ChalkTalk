## Context

See `proposal.md` for motivation. The target requirements are in the two spec deltas.

The API already accepts repeated `tag` values and matches any of them. `postListQuery` in `apps/api/src/http/app.ts` trims, lowercases, and deduplicates tags, but it does not enforce the documented `maxItems: 10`. `PostService.list` in `apps/api/src/posts/service.ts` filters with `EXISTS (... t.name = ANY($tags))`. It binds cursors to a SHA-256 hash of the course, the viewer, and every filter.

The web app keeps one tag:

- `FeedFilters.tag` in `apps/web/src/app/routes.ts`.
- One `query.set("tag", ...)` in `apps/web/src/posts/client.ts`.
- `selectTag` replaces the tag, in `apps/web/src/posts/views.tsx`.

The sidebar is one `<fieldset disabled={duplicate review}>` holding two `<select>` elements and an optional active-tag chip. The discussion view already tracks `desktopFilters` from `matchMedia("(min-width: 851px)")`. That flag starts `false` when `matchMedia` is unavailable, which is the case under jsdom. The collapsible-sidebar design (`docs/design/2026-09-29-collapsible-discussion-filters.md`) keeps presentation state local and unpersisted. This design follows the same rule.

## Goals / Non-Goals

**Goals:**

- Keep the API change backward compatible: omitting `tagMatch` behaves exactly as today.
- Get single-choice keyboard behavior and assistive-technology semantics from native elements rather than custom widgets.
- Keep the filter state and URL handling in one place.

**Non-Goals:**

- A browsable list of course tags. No endpoint lists them, and chips remain the only way to add a tag.
- Remembering which sections are open.
- Changing the collapsible sidebar, the post view picker, or search.

## Decisions

### API: `tagMatch` is normalized before the cursor binding

`postListQuery` accepts `tagMatch` as `any` or `all` and returns `400 invalid_request` for anything else. It passes `tagMatch: "all"` into the service filters only when two or more distinct tags remain after normalization. Otherwise it passes nothing.

- The binding hashes every filter, so this has two effects:
  - An omitted `tagMatch` and an explicit `any` produce the same cursors.
  - With one tag, `any` and `all` also produce the same cursors.
- Switching modes with two or more tags invalidates the cursor, as the spec requires.
- Alternative considered: always hashing the raw value. That would reject harmless replays, such as `any` versus omitted, for identical result sets.

### API: the all-tags condition is a count

For `all`, the service uses this condition:

```sql
(SELECT count(*) FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
  WHERE pt.post_id = p.id AND t.name = ANY($tags)) = cardinality($tags)
```

This is correct because tag names are unique per course, `post_tags` links a post to each tag once, and the input list is already deduplicated. The `any` path keeps the existing `EXISTS`.

- Alternative considered: one `EXISTS` per tag. It builds dynamic SQL for no gain at 10 or fewer tags.

### API: the 10-tag limit counts raw parameters

The limit is checked on the raw `tag` values before deduplication, matching OpenAPI `maxItems: 10`. The same list always gets the same result, and the documented schema stays the single source of truth.

### Web: filter state holds a tag list, and the app translates its default

In `routes.ts`, `FeedFilters.tag?: string` becomes `tags?: string[]`, plus `tagMatch?: "any"`. Only the non-default choice is stored.

- **`filtersFromSearch`:** reads every `tag`, then trims each, caps it at 40 characters, drops duplicates case-insensitively while keeping first-seen order, and keeps the first 10. It keeps `tagMatch` only when the value is `any` and two or more tags remain.
- **`feedSearch`:** writes one `tag` per entry, and writes `tagMatch=any` under the same condition.
- **`client.ts`:** appends each tag. When two or more tags are active, it sends `tagMatch=all` unless the filters say `any`.

This keeps the app default (All) in the browser, and bookmarked links stay short.

- Alternative considered: making `all` the API default. That would silently change the behavior of an existing public parameter.

### Web: accordion sections use a header button and native radios

Each section renders:

- A heading that contains a `<button aria-expanded aria-controls>`. The button text is the section name, plus ` · {current label}` while the section is closed.
- A panel holding a `<fieldset>` with a visually hidden `<legend>`, and one `<label>` with a visually hidden `<input type="radio">` per choice. The label is styled as a row, and the checked row gets accent-colored bold text and the accent bar used for the selected post card. Headers are small uppercase section labels with a divider between sections, so they read as structure rather than competing with the selected row.

Native radios provide:

- arrow-key movement within the group;
- the "selected" state for assistive technology;
- disabling through `fieldset[disabled]`.

In duplicate review, only the choice fieldsets and tag controls are disabled, so the header buttons stay operable.

- Alternatives considered:
  - `<details>`/`<summary>`: its disclosure state and marker are harder to control, and it cannot sit outside the disabled fieldset while it is also the group label.
  - Buttons with `role="radio"`: they require hand-written roving focus and arrow-key handling.

The Tags section uses the same header-button pattern, but has no closed summary beyond the count, as in "Tags · 2". It contains:

- the chip list;
- the Any/All radios, shown with two or more tags;
- Clear all;
- a `role="status"` message for the 10-tag limit.

### Web: the starting open state is read once

Section open state is local `useState`. Its initial value is `true` unless `matchMedia` exists and `(min-width: 851px)` does not match. That is the same query the sidebar collapse uses, so existing viewport test doubles apply unchanged. It is not tied to the live `desktopFilters` flag. This satisfies "chosen at load, unchanged on resize", and it keeps sections open under jsdom, where `matchMedia` is missing.

### Web: tag chips toggle, and the active state is shared

`selectTag(name)` adds the tag, or removes it if it is already active; names are compared case-insensitively. When 10 tags are already active, it sets the limit message and changes nothing else. Card and post-view chips already receive the active tag for the `active` class, and now receive the list instead.

### Switcher: remove the panel link only

This deletes the `.switcher-home` anchor in `CourseSwitcher` and its styles. The breadcrumb link, and its draft-discard prompt, are unchanged.

## Risks / Trade-offs

- **Renaming `tag` to `tags` affects every consumer of `FeedFilters`, and `views.test.tsx` is large.** → Make the rename type-driven so the compiler finds each use. Update tests alongside, and keep the existing single-tag scenarios passing under the new names.
- **With both sections open, the sidebar can overflow short desktop windows.** → The sidebar scrolls within its own column, like the other desktop columns. Members can also close a section.
- **A shared URL with more than 10 tags loses the extras silently.** → This is acceptable because the app itself never produces such a URL, and the API rejects the extras anyway.
- **External clients that sent more than 10 tags start receiving `400`.** → The limit was already documented. Call it out in the API reference change note.

## Migration Plan

No data migration is needed. Deploy the API and web app together. The API change is additive apart from the 10-tag enforcement, so the new web app must not run against an old API: an old API would ignore `tagMatch=all` and return matches for any tag. Rollback reverts both with no stored state to undo.
