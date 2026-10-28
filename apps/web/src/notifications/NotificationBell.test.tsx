import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NOTIFICATION_POLL_MS, NotificationBell } from "./NotificationBell.js";
import type { Notification } from "./client.js";

const answered: Notification = {
  id: "0192f7a4-58ae-7009-9f43-d1ba75831d5f",
  kind: "answer_created",
  courseId: "course_1",
  courseName: "CS 101",
  postId: "post_1",
  postTitle: "Why does my loop never stop?",
  actor: { displayName: "Grace Hopper" },
  createdAt: new Date().toISOString(),
  readAt: null,
};
const anonymous: Notification = {
  ...answered,
  id: "0192f7a4-58ae-7009-9f43-d1ba75831d60",
  kind: "followup_created",
  postId: "post_2",
  postTitle: "Recursion depth",
  actor: { displayName: "Anonymous" },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Routes the bell's three requests; the count can change between calls. */
function api(counts: number[], items: Notification[] = [answered, anonymous]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/unread-count"))
      return json({
        data: { count: counts.length > 1 ? counts.shift() : counts[0] },
      });
    if (url.startsWith("/api/v1/users/me/notifications?"))
      return json({ data: items, page: { nextCursor: null, hasMore: false } });
    if (url.endsWith("/read") && init?.method === "POST")
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const countCalls = (fetchMock: ReturnType<typeof api>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/unread-count"))
    .length;

describe("notification bell", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("labels the unread count for assistive technology", async () => {
    api([2]);
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("refreshes the count on an interval and when the window regains focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = api([0, 1, 3]);
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Notifications" }),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_MS);
    });
    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeTruthy();
    expect(countCalls(fetchMock)).toBe(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(
      await screen.findByRole("button", { name: "Notifications, 3 unread" }),
    ).toBeTruthy();
  });

  it("lists notifications, hides anonymous names, and opens the chosen post", async () => {
    const fetchMock = api([2]);
    const onOpenPost = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={onOpenPost}
        onOpenThread={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    );
    const panel = screen.getByRole("region", { name: "Notifications" });
    const items = await within(panel).findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining(
        "Grace Hopper answered Why does my loop never stop?",
      ),
      expect.stringContaining("Anonymous posted a followup on Recursion depth"),
    ]);
    expect(items[0]!.textContent).toContain("CS 101");
    expect(items[0]!.textContent).toContain(", unread");

    await user.click(within(items[0]!).getByRole("button"));
    expect(onOpenPost).toHaveBeenCalledWith("course_1", "post_1");
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeTruthy();
    const read = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/read"),
    )!;
    expect(read[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf" }),
      body: JSON.stringify({ ids: [answered.id] }),
    });
  });

  it("marks all read and closes on Escape", async () => {
    const fetchMock = api([2]);
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    );
    const panel = screen.getByRole("region", { name: "Notifications" });
    await within(panel).findAllByRole("listitem");
    await user.click(
      within(panel).getByRole("button", { name: "Mark all read" }),
    );
    expect(
      await screen.findByRole("button", { name: "Notifications" }),
    ).toBeTruthy();
    expect(panel.textContent).not.toContain(", unread");
    const read = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/read"),
    )!;
    expect(read[1]).not.toHaveProperty("body");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("words a post being made public", async () => {
    api(
      [1],
      [
        {
          ...answered,
          kind: "post_published",
          actor: { displayName: "Tara TA" },
        },
      ],
    );
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    expect((await screen.findAllByRole("listitem"))[0]!.textContent).toContain(
      "Tara TA made your post public: Why does my loop never stop?",
    );
  });

  it("words a mention", async () => {
    api(
      [1],
      [{ ...answered, kind: "mentioned", actor: { displayName: "Anonymous" } }],
    );
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    expect((await screen.findAllByRole("listitem"))[0]!.textContent).toContain(
      "Anonymous mentioned you on Why does my loop never stop?",
    );
  });

  it("opens a Thread reply without treating it as a Post notification", async () => {
    const threadReply = {
      id: "0192f7a4-58ae-7009-9f43-d1ba75831d70",
      kind: "thread_reply_created" as const,
      courseId: "course_1",
      courseName: "CS 101",
      threadId: "thread_1",
      threadTitle: "Find a project team",
      conversationId: "conversation_1",
      messageId: "message_1",
      preview: "I can join your team.",
      actor: { displayName: "Ada Lovelace" },
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    const fetchMock = api([1, 1, 0], [threadReply]);
    const onOpenPost = vi.fn();
    const onOpenThread = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={onOpenPost}
        onOpenThread={onOpenThread}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    const card = (await screen.findAllByRole("listitem"))[0]!;
    expect(card.textContent).toContain("Ada Lovelace replied");
    expect(card.textContent).toContain("Find a project team");
    expect(card.textContent).toContain("I can join your team.");
    await user.click(within(card).getByRole("button"));
    expect(onOpenThread).toHaveBeenCalledWith(
      "course_1",
      "thread_1",
      "conversation_1",
      "message_1",
      threadReply.id,
    );
    expect(onOpenPost).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/read")),
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeTruthy();
    window.dispatchEvent(new Event("chalktalk:notifications-changed"));
    expect(
      await screen.findByRole("button", { name: "Notifications" }),
    ).toBeTruthy();
  });

  it("explains an empty inbox", async () => {
    api([0], []);
    const user = userEvent.setup();
    render(
      <NotificationBell
        csrfToken="csrf"
        onOpenPost={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    expect(
      await screen.findByText(/Activity on posts you follow shows up here/),
    ).toBeTruthy();
  });
});
