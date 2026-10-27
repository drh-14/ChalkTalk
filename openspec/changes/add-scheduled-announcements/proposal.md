# Proposal

## Why

Staff often know an announcement's content before its time, such as exam logistics the night before or a reminder for Monday morning. Today they must remember to post at that moment. Scheduling lets them write it now and have ChalkTalk publish it, pinned and emailed, at the chosen time.

The user chose to build this.

These details are assumptions, recorded here for review:

- Only TAs and instructors schedule.
- A time is 1 minute to 365 days ahead.
- Scheduled announcements can be edited, rescheduled, published immediately, or deleted.
- Students cannot see a scheduled announcement until it publishes.
- If the course is not active at the scheduled time, it stays scheduled until staff publish it.

## What Changes

- **Scheduling.** When staff choose **Post as announcement**, they can pick **Publish later** and a date and time.
- **Before publishing.** A scheduled announcement is visible only to course staff. It is badged **Scheduled** with its time, and it sends no notification or email and is not in the digest.
- **Publishing.** At the scheduled time, the job worker publishes it: the post's creation and activity times become the publish time, it stays pinned, and every member is notified and emailed, exactly as an immediate announcement is.
- **Changing plans.** Staff can edit it, set a new time, **Publish now**, or delete it. Any of these cancels the earlier schedule.

## Capabilities

### New Capabilities

- `scheduled-announcements`: scheduling, hiding, publishing, and rescheduling announcements.

### Modified Capabilities

None. The announcement behavior defined by polls-and-announcements still happens, at the publish time.

## Impact

- **Database:** migration `052_scheduled_announcements.sql` adds `posts.scheduled_for` (announcements only) and the `publish_scheduled_announcement` job kind.
- **API:**
  - `scheduledFor` on create and update for announcements, and on projections;
  - scheduled posts readable only by staff, through the shared visibility rule;
  - the errors `schedule_invalid` and `not_scheduled`.
- **Worker:** the `publish_scheduled_announcement` handler.
- **Web:** **Publish later** in the composer, the **Scheduled** badge, and the scheduled notice with **Publish now** and **Reschedule**.
- **Docs:** `posts.md`, `identity-visibility.md`, `openapi.yaml`, and `database.md`.
