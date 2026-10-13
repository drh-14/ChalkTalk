import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
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
const summary = (period: string, postsViewed = 4) => ({
  data: {
    courseId: "course_1",
    period,
    dailyActivity: [
      {
        date: "2026-10-11",
        questionsCreated: 2,
        answersCreated: 1,
        postsViewed,
      },
    ],
    postsViewed,
    averageResponseTimeSeconds: 3600,
    generatedAt: "2026-10-11T20:00:00Z",
  },
});

it("shows recorded activity and a zero-activity student, then changes period", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/students")
      ? json({
          data: [
            {
              user: { id: "student_1", displayName: "Ada" },
              questionsCreated: 0,
              answersContributed: 0,
              postsViewed: 0,
            },
          ],
          page: { hasMore: false, nextCursor: null },
        })
      : json(summary(url.includes("period=7d") ? "7d" : "30d")),
  );
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<CourseStatistics courseId="course_1" />);
  expect(await screen.findByText("Ada")).toBeTruthy();
  expect(
    screen.getByText("4", { selector: ".statistics-metric-value" }),
  ).toBeTruthy();
  expect(
    screen.getByText("Time from question to first endorsed answer"),
  ).toBeTruthy();
  expect(screen.getByText(/recorded views begin/i)).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Period"), "7d");
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes("period=7d")),
    ).toBe(true),
  );
});

it("loads another student page and retries a failed summary", async () => {
  let failed = true;
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.includes("/students") && failed) {
      failed = false;
      return json({ error: { message: "Temporarily unavailable" } }, 503);
    }
    if (url.includes("cursor=next"))
      return json({
        data: [
          {
            user: { id: "2", displayName: "Bea" },
            questionsCreated: 0,
            answersContributed: 0,
            postsViewed: 0,
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    if (url.includes("/students"))
      return json({
        data: [
          {
            user: { id: "1", displayName: "Ada" },
            questionsCreated: 1,
            answersContributed: 0,
            postsViewed: 0,
          },
        ],
        page: { hasMore: true, nextCursor: "next" },
      });
    return json(summary("30d"));
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<CourseStatistics courseId="course_1" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Temporarily unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Ada")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load more students" }));
  expect(await screen.findByText("Bea")).toBeTruthy();
});

it("discards an old student page after the period changes", async () => {
  let finishOldPage!: (response: Response) => void;
  const oldPage = new Promise<Response>((resolve) => {
    finishOldPage = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("cursor=next")) return oldPage;
      if (url.includes("/students")) {
        const recent = url.includes("period=7d");
        return json({
          data: [
            {
              user: {
                id: recent ? "3" : "1",
                displayName: recent ? "Clara" : "Ada",
              },
              questionsCreated: 0,
              answersContributed: 0,
              postsViewed: 0,
            },
          ],
          page: { hasMore: !recent, nextCursor: recent ? null : "next" },
        });
      }
      return json(summary(url.includes("period=7d") ? "7d" : "30d"));
    }),
  );
  const user = userEvent.setup();
  render(<CourseStatistics courseId="course_1" />);
  expect(await screen.findByText("Ada")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Load more students" }));
  await user.selectOptions(screen.getByLabelText("Period"), "7d");
  expect(await screen.findByText("Clara")).toBeTruthy();
  await act(async () => {
    finishOldPage(
      json({
        data: [
          {
            user: { id: "2", displayName: "Bea" },
            questionsCreated: 0,
            answersContributed: 0,
            postsViewed: 0,
          },
        ],
        page: { hasMore: false, nextCursor: null },
      }),
    );
    await oldPage;
  });
  expect(screen.queryByText("Bea")).toBeNull();
  expect(screen.queryByText("Ada")).toBeNull();
  expect(screen.queryByText("Loading…")).toBeNull();
});

it("scopes an empty response-time metric to the selected period", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/students")
        ? json({ data: [], page: { hasMore: false, nextCursor: null } })
        : json({
            data: { ...summary("7d").data, averageResponseTimeSeconds: null },
          }),
    ),
  );
  render(<CourseStatistics courseId="course_1" />);
  expect(
    await screen.findByText("No answers", {
      selector: ".statistics-metric-value",
    }),
  ).toBeTruthy();
  expect(screen.queryByText("No endorsed answers in this period")).toBeNull();
});

it("shows no activity for a zero-filled daily series", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/students")
        ? json({ data: [], page: { hasMore: false, nextCursor: null } })
        : json({
            data: {
              ...summary("30d", 0).data,
              dailyActivity: [
                {
                  date: "2026-10-11",
                  questionsCreated: 0,
                  answersCreated: 0,
                  postsViewed: 0,
                },
              ],
            },
          }),
    ),
  );
  render(<CourseStatistics courseId="course_1" />);
  expect(await screen.findByText("No activity in this period.")).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
});
