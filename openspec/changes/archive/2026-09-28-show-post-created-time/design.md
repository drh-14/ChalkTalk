## Context

Every active post projection the frontend receives, from the feed list, the post detail, and the staff duplicate-review endpoint, already includes an ISO 8601 UTC `createdAt`, and the web `Post` type already declares it. `apps/web/src/posts/views.tsx` renders the author at three sites (the feed card `<small>`, the detail `.post-author`, and the review detail `.post-author`) but never a time. The web app has no date-formatting helper and no date library, and existing rendered tests use date-only `createdAt` fixtures such as `"2026-01-01"`.

## Goals / Non-Goals

**Goals:**

- One formatter and one byline element shared by all three sites, so the wording and markup cannot drift.
- Rendered tests that pass in any host time zone and on any calendar day.

**Non-Goals:**

- Live-updating times while a page stays open; a time refreshes when its component re-renders.
- Localizing the rest of the UI or giving users a format preference.

## Decisions

**Use built-in `Intl`, not a date library.** `Intl.RelativeTimeFormat("en", { numeric: "always" })` produces the minutes, hours, and days wording (`"auto"` would print "yesterday" instead of "1 day ago"), `Intl.DateTimeFormat("en", { month: "short", day: "numeric" })` (adding `year` when it differs) produces the older-post date, and a `dateStyle: "medium", timeStyle: "short"` formatter produces the hover title. Both are in the app's ES2022 target and add no bundle weight. date-fns or dayjs would work but add a dependency for three short calculations.

**Pure formatter with an injectable clock.** A small `formatPostTime(createdAt, now = new Date())` module in `apps/web/src/posts/` returns `{ label, title, dateTime }`, or `undefined` for an unparsable value. It uses whole-unit floors (under 60 s is "just now", under 60 min is minutes, under 24 h is hours, and under 7 days is days), clamps a future `createdAt` to "just now", and passes the original string to `dateTime`. Taking `now` as a parameter keeps unit tests independent of fake timers. The alternative, formatting inline in JSX, would duplicate the threshold logic at three sites.

**A `PostByline` component.** It renders `displayName` followed by a separator and a `<time dateTime title>` element, and renders only the name when the formatter returns `undefined`. The feed card keeps its `<small>` wrapper and the detail panes keep `.post-author`, so the existing selectors and styling still apply; only a small separator style is added. The byline does not render anything from `updatedAt`, `lastActivityAt`, or `author.userId`.

**Time-zone-safe tests.** The formatter unit tests pin `now` and use UTC-instant inputs whose expected relative labels do not depend on the zone (for example, three hours before `now`). They assert the calendar-date label only for instants that are the same calendar day in all zones, or they compute the expectation with the same `Intl` formatter. The rendered view tests fix `Date` with `vi.setSystemTime` and assert the relative label plus the `<time>` element's `dateTime` attribute, rather than a locale-formatted absolute string.

## Risks / Trade-offs

- [The label goes stale in a long-open tab, so "just now" stays "just now".] → Accepted for this change; a periodic refresh can be added later without changing the spec's formatting rules.
- [The client clock is wrong or skewed ahead of the server.] → Future instants clamp to "just now", so the UI never shows "in 2 minutes".
- [Every seeded AMS161 post shows the same time.] → This is a known seed limitation named in the proposal, left for a separate fixture change.
- [Existing date-only fixtures (`"2026-01-01"`) parse as UTC midnight and render as an old calendar date.] → They remain valid, and existing assertions do not inspect the byline text, so they stay unaffected.
