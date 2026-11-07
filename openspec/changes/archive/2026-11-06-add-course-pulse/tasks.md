# Tasks

## 1. API

- [x] 1.1 Integration tests from the spec: staff response shape over an older semester, local-time bucketing, zero-filled weeks, anonymous answers excluded from helpers, student 403, non-member 404, unknown zone 400, empty course
- [x] 1.2 `StatisticsService.pulse` and the route; API reference and OpenAPI entries

## 2. Web

- [x] 2.1 Client and Course pulse / Activity views with tiles, heatmap, weekly chart, topics, helpers, tooltips, table toggle, empty state
- [x] 2.2 Component tests: default view, Activity switch, tiles, table toggle, empty state
- [x] 2.3 Duplicates entry in the sidebar Show section, with the duplicate-review tests updated
- [x] 2.4 Automatic feed paging, the All caught up status, the collapsible sidebar tab, and the persistent course header
- [x] 2.5 Layout-holding loading states: feed, post, answer, and Course pulse placeholders, the course-name placeholder, tabs and staff controls that appear together, and delayed loading messages

## 3. Import

- [x] 3.1 Drop the `NaN` suffix from imported image names, with a conversion test

## 4. Verification

- [x] 4.1 Browser test with a mocked API: Course pulse, its skeleton, Duplicates in the sidebar, and feed placeholders, with screenshots
- [x] 4.2 Check the real CSE 214 data; run tests, typecheck, and lint
