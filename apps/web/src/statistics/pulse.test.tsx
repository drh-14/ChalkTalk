import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { busiestBlock, duration } from "./pulse-format.js";
import { CourseStatistics } from "./views.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const hours = () => {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  grid[2]![10] = 3;
  grid[2]![11] = 2;
  grid[4]![20] = 1;
  return grid;
};
const pulse = (questions = 6) => ({
  data: {
    courseId: "course_1",
    timeZone: "America/New_York",
    firstQuestionAt: questions ? "2024-09-03T14:30:00Z" : null,
    lastQuestionAt: questions ? "2024-09-24T02:00:00Z" : null,
    questions,
    answered: questions ? 4 : 0,
    unanswered: questions ? 2 : 0,
    medianFirstAnswerMinutes: questions ? 66 : null,
    hours: questions
      ? hours()
      : Array.from({ length: 7 }, () => Array(24).fill(0)),
    weeks: questions
      ? [
          { weekStart: "2024-09-01", questions: 5 },
          { weekStart: "2024-09-08", questions: 0 },
          { weekStart: "2024-09-15", questions: 1 },
        ]
      : [],
    topics: questions
      ? [
          {
            tag: "hw1",
            questions: 4,
            unanswered: 1,
            medianFirstAnswerMinutes: 30,
          },
        ]
      : [],
    helpers: questions
      ? [
          {
            userId: "user_1",
            displayName: "Kevin Darby",
            role: "ta",
            answers: 3,
          },
        ]
      : [],
    generatedAt: "2026-11-06T14:30:00Z",
  },
});
function stub(body = pulse()) {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/statistics/pulse")
      ? json(body)
      : url.includes("/statistics/students")
        ? json({ data: [], page: { hasMore: false, nextCursor: null } })
        : json({
            data: {
              courseId: "course_1",
              period: "30d",
              dailyActivity: [],
              postsViewed: 0,
              averageResponseTimeSeconds: null,
              generatedAt: "2026-11-06T14:30:00Z",
            },
          }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("opens on Course pulse in the viewer's time zone with headline tiles and no period", async () => {
  const fetchMock = stub();
  render(<CourseStatistics courseId="course_1" />);
  expect(screen.getByRole("status").textContent).toBe("Loading course pulse…");
  expect(
    screen
      .getByRole("button", { name: "Course pulse" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  const tile = (await screen.findByRole("heading", { name: "Busiest time" }))
    .parentElement!;
  expect(tile.textContent).toContain("Tue 9 am–12 pm");
  expect(tile.textContent).toContain("5 questions in that window");
  expect(
    screen.getByRole("heading", { name: "Peak week" }).parentElement!
      .textContent,
  ).toContain("5 questions");
  expect(
    screen.getByRole("heading", { name: "First answer" }).parentElement!
      .textContent,
  ).toContain("1.1 hr");
  expect(
    screen.getByRole("heading", { name: "Unanswered" }).parentElement!
      .textContent,
  ).toContain("of 6 questions still waiting");
  expect(screen.queryByLabelText("Period")).toBeNull();
  const requested = new URL(fetchMock.mock.calls[0]![0], "https://x.test");
  expect(requested.pathname).toBe("/api/v1/courses/course_1/statistics/pulse");
  expect(requested.searchParams.get("timeZone")).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
});

it("labels every heatmap cell and weekly bar, and shows topics and helpers", async () => {
  stub();
  render(<CourseStatistics courseId="course_1" />);
  const heatmap = await screen.findByRole("group", {
    name: "Questions by weekday and hour",
  });
  expect(within(heatmap).getAllByLabelText(/question/)).toHaveLength(168);
  expect(
    within(heatmap).getByLabelText("Tuesday 10 am: 3 questions"),
  ).toBeTruthy();
  const weeks = screen.getByRole("group", { name: "Questions per week" });
  expect(within(weeks).getByLabelText(/: 0 questions$/)).toBeTruthy();
  expect(
    within(weeks)
      .getAllByLabelText(/^Week of /)[0]!
      .getAttribute("tabindex"),
  ).toBe("0");
  expect(screen.getByRole("rowheader", { name: "#hw1" })).toBeTruthy();
  expect(screen.getByText("Kevin Darby")).toBeTruthy();
  expect(screen.getByText("TA")).toBeTruthy();
  expect(screen.getByText("Anonymous answers are not counted.")).toBeTruthy();
});

it("offers the heatmap and weekly data as tables", async () => {
  stub();
  const user = userEvent.setup();
  render(<CourseStatistics courseId="course_1" />);
  await user.click(
    await screen.findByRole("button", { name: "Show as tables" }),
  );
  expect(
    screen.queryByRole("group", { name: "Questions by weekday and hour" }),
  ).toBeNull();
  expect(screen.getByRole("rowheader", { name: "Tue" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Week of" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Show as charts" }));
  expect(
    screen.getByRole("group", { name: "Questions by weekday and hour" }),
  ).toBeTruthy();
});

it("shows an empty state for a course without questions", async () => {
  stub(pulse(0));
  render(<CourseStatistics courseId="course_1" />);
  expect(await screen.findByText("No questions yet")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Busiest time" })).toBeNull();
});

it("switches to Activity with its period selector", async () => {
  stub();
  const user = userEvent.setup();
  render(<CourseStatistics courseId="course_1" />);
  await screen.findByRole("heading", { name: "Busiest time" });
  await user.click(screen.getByRole("button", { name: "Activity" }));
  expect(
    screen
      .getByRole("button", { name: "Activity" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(await screen.findByLabelText("Period")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Busiest time" })).toBeNull();
});

it("formats waits and finds the busiest three-hour block", () => {
  expect(duration(null)).toBe("No answers yet");
  expect(duration(42.4)).toBe("42 min");
  expect(duration(90)).toBe("1.5 hr");
  expect(duration(3 * 1440)).toBe("3.0 days");
  expect(busiestBlock(hours())).toEqual({ day: 2, start: 9, questions: 5 });
});
