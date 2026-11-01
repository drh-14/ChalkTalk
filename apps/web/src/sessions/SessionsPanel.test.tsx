import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CourseCollaboration } from "./SessionsPanel.js";

const active = {
  id: "s-active",
  courseId: "c-1",
  status: "active",
  title: "Loop help",
  language: "python",
  createdBy: "alice",
  finalSnapshotConfirmed: true,
  participants: [
    {
      userId: "alice",
      displayName: "Alice",
      role: "creator",
      permission: "edit",
    },
  ],
  endedAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  version: 1,
};
const ended = {
  ...active,
  id: "s-ended",
  status: "ended",
  title: "Earlier session",
  finalSnapshotConfirmed: false,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function api(sessions: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "POST")
        return json({ data: { ...active, id: "s-new" } }, 201);
      return json({
        data: sessions,
        page: { nextCursor: null, hasMore: false },
      });
    }),
  );
  return calls;
}
function panel(activeCourse = true) {
  const onOpen = vi.fn();
  render(
    <CourseCollaboration
      courseId="c-1"
      active={activeCourse}
      csrfToken="csrf"
      onOpen={onOpen}
    />,
  );
  return onOpen;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists participant sessions in their course and opens active and ended sessions", async () => {
  const calls = api([active, ended]);
  const onOpen = panel();
  await screen.findByText("Loop help");
  expect(calls[0]!.url).toBe("/api/v1/courses/c-1/collaboration-sessions");
  expect(screen.getByText("Earlier session")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open Loop help" }));
  expect(onOpen).toHaveBeenCalledWith("s-active");
  await user.click(
    screen.getByRole("button", { name: "View Earlier session" }),
  );
  expect(onOpen).toHaveBeenCalledWith("s-ended");
});

it("creates a course session with a required title and no post anchor", async () => {
  const calls = api([]);
  const onOpen = panel();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  await user.type(screen.getByLabelText("Title"), "Pointers");
  await user.selectOptions(screen.getByLabelText("Language"), "cpp");
  await user.click(screen.getByRole("button", { name: "Start session" }));
  expect(onOpen).toHaveBeenCalledWith("s-new");
  const create = calls.find((call) => call.init?.method === "POST")!;
  expect(JSON.parse(String(create.init!.body))).toEqual({
    title: "Pointers",
    language: "cpp",
  });
});

it("does not allow starting in an archived course", async () => {
  api([]);
  panel(false);
  await screen.findByText("No collaboration sessions yet.");
  expect(
    screen.queryByRole("button", { name: "Start live session" }),
  ).toBeNull();
});

it("keeps the creation form when the API rejects the request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(
            {
              error: {
                code: "course_archived",
                message: "Course is not active",
              },
            },
            409,
          )
        : json({ data: [], page: { nextCursor: null, hasMore: false } }),
    ),
  );
  panel();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  await user.type(screen.getByLabelText("Title"), "Pointers");
  await user.click(screen.getByRole("button", { name: "Start session" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Course is not active",
  );
  expect(screen.getByLabelText("Title")).toBeTruthy();
});
