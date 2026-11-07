# Design

## Decisions

- **Whole-history window, independent of period.** Pulse reads question timestamps directly, so imported courses whose posts predate the course record still show their semester. The existing period-based Activity view is unchanged.
- **Local time in SQL.** The client sends its IANA zone; the API validates it against `pg_timezone_names` and buckets with `created_at AT TIME ZONE $zone`. The week start is computed as the local Sunday: `date_trunc('week', local + 1 day) - 1 day`. Missing weeks are filled in the service, so the chart's x-axis is continuous.
- **Answered means any non-deleted answer**, matching the feed's answered status. First-answer time uses the earliest non-deleted answer.
- **Helpers exclude anonymous answers** at the query level, so identities cannot leak through the leaderboard.
- **Charts are plain SVG/HTML** with no chart dependency:
  - **Color:** following the data-visualization method, the heatmap uses one green sequential ramp from light to dark (the brand accent). The weekly bars are a single series in the accent color, with the title naming them, so no legend is needed.
  - **Interaction:** tooltips show on hover and keyboard focus.
  - **Accessibility:** a "Show as table" toggle provides the accessible alternative.
  - **Dark mode:** the app has no dark theme, so only light mode is styled.
- **Tabs inside Statistics** rather than a new course tab keep instructor analytics in one place and avoid crowding the app bar.
