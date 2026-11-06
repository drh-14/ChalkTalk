# Proposal

## Why

With real imported courses, the course pages feel unfinished and inconsistent:

- a two-row header;
- oversized Q&A panels;
- a stacked search area;
- a flat feed with no sense of time;
- pages that each style their title, description, and buttons differently;
- empty pages that show a single line of text.

## What Changes

- **Header:**
  - One slim row, with an avatar menu (name, email, Account settings, Sign out) replacing the always-visible name and Sign out.
  - The course name itself opens the course switcher.
- **Feed:**
  - Pinned and date sections (Today, Yesterday, Earlier this week, Last week, then weekly), each collapsible with a post count.
  - Search and New post share one row.
- **Q&A:** smaller answer panels and headings, and one chip style for answer and followup actions. A chat icon replaces the "◯" glyph on Followup Discussions.
- **Course pages:**
  - A shared title, description, and header-action pattern; Threads gains a description, and Create thread moves into its header.
  - Course information, Staff, and Course settings gain titles and descriptions.
  - One content width for every page.
  - One title style for cards and sections.
  - Two button sizes.
  - Home and Account titles at one serif size.
- **Empty states:** an illustrated card when no post is selected, when a course has no threads, and when there are no collaboration sessions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `course-discussion-frontend`: the course header's switcher and account menu; feed sections; the shared page frame and empty states.

## Impact

`apps/web` only: the app bar, posts feed and detail, answers, threads, sessions, course information, course files, settings, statistics, styles, and their tests. No API or database changes.
