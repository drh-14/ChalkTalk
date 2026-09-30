import { expect, it } from "vitest";
import { formatPostTime } from "./time.js";

const now = new Date(2026, 8, 28, 12, 0, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const label = (createdAt: string) => formatPostTime(createdAt, now)?.label;

it("shows just now under a minute and for a future time", () => {
  expect(label(ago(0))).toBe("just now");
  expect(label(ago(59 * second))).toBe("just now");
  expect(label(ago(-5 * minute))).toBe("just now");
});

it("uses minutes, hours, and days at their boundaries", () => {
  expect(label(ago(60 * second))).toBe("1 minute ago");
  expect(label(ago(59 * minute))).toBe("59 minutes ago");
  expect(label(ago(60 * minute))).toBe("1 hour ago");
  expect(label(ago(23 * hour))).toBe("23 hours ago");
  expect(label(ago(24 * hour))).toBe("1 day ago");
  expect(label(ago(6 * day))).toBe("6 days ago");
});

it("shows a short date after seven days, adding the year only for another year", () => {
  expect(label(new Date(2026, 8, 21, 12).toISOString())).toBe("Sep 21");
  expect(label(new Date(2026, 0, 3, 9).toISOString())).toBe("Jan 3");
  expect(label(new Date(2025, 11, 31, 12).toISOString())).toBe("Dec 31, 2025");
});

it("keeps the original value and gives a full local date and time title", () => {
  const createdAt = new Date(2026, 8, 21, 14, 5).toISOString();
  const time = formatPostTime(createdAt, now);
  expect(time?.dateTime).toBe(createdAt);
  expect(time?.title).toContain("Sep 21, 2026");
  expect(time?.title).toMatch(/2:05\sPM/);
});

it("omits an unparsable time", () => {
  expect(formatPostTime("not a date", now)).toBeUndefined();
  expect(formatPostTime("", now)).toBeUndefined();
});
