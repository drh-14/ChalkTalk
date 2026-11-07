# Proposal

## Why

Course statistics count activity only from the course's creation date and only as daily totals. They cannot answer the questions an instructor actually has about a semester:
- When do students get stuck?
- Which weeks and topics generate the most confusion?
- How fast do questions get answered, and who does the answering?

Imported courses make this worse: their history predates the course record, so the existing views show nothing for it.

## What Changes

- **New staff-only endpoint:** `GET /api/v1/courses/{courseId}/statistics/pulse?timeZone=<IANA>` returns, over the course's whole question history:
  - question counts by local weekday and hour, and by week;
  - question, answered, and unanswered totals;
  - median time to first answer;
  - per-tag question, unanswered, and median first-answer figures;
  - the top answer contributors, counting only non-anonymous answers.
- **The Statistics tab gains a Course pulse view,** the default, beside the existing Activity view. It shows:
  - headline tiles (busiest time, peak week, median first answer, unanswered);
  - a weekday-by-hour heatmap;
  - a weekly questions chart;
  - a topics table;
  - top helpers;
  - hover tooltips and a table alternative for the charts.
- **Discussion polish that shipped alongside it:**
  - staff duplicate review moves from a Posts/Duplicate selector above the feed to a staff-only **Duplicates** entry in the sidebar's Show section;
  - the feed loads the next page automatically as the reader nears its end, and the status row says **All caught up** when nothing is unread;
  - the filter sidebar collapses behind a round pull tab that stays half visible;
  - the course header stays at the top of the window on wide screens;
  - loading states hold the page layout: placeholder cards and post skeletons, a Course pulse skeleton, a course-name placeholder, tabs and staff-only controls that appear together, and loading messages that appear only after a short delay;
  - the Markdown editor, response composer footer, and answer actions are restyled as single framed controls with icons; these keep their accessible names and behavior.
- **Piazza import:** imported image names drop the `NaN` Piazza appends to pasted images.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-statistics`: the course pulse endpoint and view.
- `course-discussion-frontend`: duplicate review in the sidebar, automatic feed paging, the caught-up status, the collapsible sidebar tab, the persistent course header, and layout-holding loading states.
- `piazza-course-import`: imported image names drop Piazza's `NaN` suffix.

## Impact

- **API:** `StatisticsService.pulse`, a new route, and the API reference and OpenAPI entries.
- **Web:** the statistics client and view; the discussion feed, sidebar, editor, composer, answers, and app header; a shared loading module; and styles.
- **Import:** the Piazza image conversion rule.
- **Database:** no schema change. The endpoint reads existing posts, answers, tags, and answer contribution events.
