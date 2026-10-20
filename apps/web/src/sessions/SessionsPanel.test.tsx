import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ActiveSessionLink, SessionsPanel } from "./SessionsPanel.js";

const base = {
  courseId: "c-1",
  anchor: { postId: "p-1" },
  createdBy: "alice",
  endedAt: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  version: 1,
};
const active = {
  ...base,
  id: "s-active",
  status: "active",
  title: "Loop help",
  language: "python",
  participants: [
    { userId: "alice", displayName: "Alice", role: "creator" },
    { userId: "tim", displayName: "Tim", role: "invitee" },
  ],
};
const ended = {
  ...base,
  id: "s-ended",
  status: "ended",
  title: "Earlier session",
  language: "java",
  endedAt: "2026-10-18T00:00:00Z",
  participants: [{ userId: "alice", displayName: "Alice", role: "creator" }],
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
function panel(courseStatus = "active") {
  const onOpen = vi.fn();
  render(
    <SessionsPanel
      courseId="c-1"
      postId="p-1"
      courseStatus={courseStatus}
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

it("lists the post's visible active sessions and hides ended ones behind a toggle", async () => {
  const calls = api([active, ended]);
  const onOpen = panel();
  await screen.findByText("Loop help");
  expect(calls[0]!.url).toBe(
    "/api/v1/courses/c-1/collaboration-sessions?anchorType=post&anchorId=p-1",
  );
  expect(screen.getByText(/Python · Alice, Tim/)).toBeTruthy();
  expect(screen.queryByText("Earlier session")).toBeNull();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Show ended sessions (1)" }),
  );
  expect(screen.getByText("Earlier session")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Join Loop help" }));
  expect(onOpen).toHaveBeenCalledWith("s-active");
  await user.click(
    screen.getByRole("button", { name: "View Earlier session" }),
  );
  expect(onOpen).toHaveBeenCalledWith("s-ended");
});

it("shows an empty state when there are no active sessions", async () => {
  api([]);
  panel();
  expect(
    await screen.findByText("No active live sessions on this post."),
  ).toBeTruthy();
});

it("starts a session with the chosen language, warns about names, and opens it", async () => {
  const calls = api([]);
  const onOpen = panel();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  expect(
    screen.getByText(
      /Participants see your name, even if you posted anonymously/,
    ),
  ).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Language"), "cpp");
  await user.type(screen.getByLabelText("Title (optional)"), "Pointers");
  await user.click(screen.getByRole("button", { name: "Start session" }));
  expect(onOpen).toHaveBeenCalledWith("s-new");
  const create = calls.find((call) => call.init?.method === "POST")!;
  expect(create.url).toBe("/api/v1/courses/c-1/collaboration-sessions");
  expect(JSON.parse(String(create.init!.body))).toEqual({
    anchor: { postId: "p-1" },
    language: "cpp",
    title: "Pointers",
  });
});

it("keeps the dialog open and shows the error if starting fails", async () => {
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
  const onOpen = panel();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  await user.click(screen.getByRole("button", { name: "Start session" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Course is not active",
  );
  expect(onOpen).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start session" })).toBeTruthy();
});

it("explains a rate-limited start", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(
            { error: { code: "rate_limited", message: "Too many requests" } },
            429,
          )
        : json({ data: [], page: { nextCursor: null, hasMore: false } }),
    ),
  );
  panel();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  await user.click(screen.getByRole("button", { name: "Start session" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "You have started a lot of sessions recently. Try again in a little while.",
  );
});

it("does not offer starting a session in an archived course", async () => {
  api([active]);
  panel("archived");
  await screen.findByText("Loop help");
  expect(
    screen.queryByRole("button", { name: "Start live session" }),
  ).toBeNull();
});

it("suggests the language named by the post's tags", async () => {
  api([]);
  render(
    <SessionsPanel
      courseId="c-1"
      postId="p-1"
      tags={["hw3", "Java"]}
      courseStatus="active"
      csrfToken="csrf"
      onOpen={vi.fn()}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Start live session" }),
  );
  expect((screen.getByLabelText("Language") as HTMLSelectElement).value).toBe(
    "java",
  );
});

it("reports its sessions so the post header can link to an active one", async () => {
  api([active]);
  const onLoaded = vi.fn();
  const onOpen = vi.fn();
  render(
    <SessionsPanel
      courseId="c-1"
      postId="p-1"
      courseStatus="active"
      csrfToken="csrf"
      onOpen={onOpen}
      onLoaded={onLoaded}
    />,
  );
  await waitFor(() => expect(onLoaded).toHaveBeenCalled());
  cleanup();
  render(
    <ActiveSessionLink sessions={onLoaded.mock.calls[0][0]} onOpen={onOpen} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Live session active/ }),
  );
  expect(onOpen).toHaveBeenCalledWith(active.id);
  cleanup();
  render(<ActiveSessionLink sessions={[]} onOpen={onOpen} />);
  expect(
    screen.queryByRole("button", { name: /Live session active/ }),
  ).toBeNull();
});
