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
  destination: { kind: "post", postId: "post_1" },
};
const anonymous: Notification = {
  ...answered,
  id: "0192f7a4-58ae-7009-9f43-d1ba75831d60",
  kind: "followup_created",
  postId: "post_2",
  postTitle: "Recursion depth",
  actor: { displayName: "Anonymous" },
  destination: { kind: "post", postId: "post_2" },
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
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    expect(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    ).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("refreshes the count on an interval and when the window regains focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = api([0, 1, 3]);
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
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
    render(<NotificationBell csrfToken="csrf" onOpenPost={onOpenPost} />);
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
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
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
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
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
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    expect((await screen.findAllByRole("listitem"))[0]!.textContent).toContain(
      "Anonymous mentioned you on Why does my loop never stop?",
    );
  });

  it("renders a response preview and opens its exact answer anchor", async () => {
    const onOpenPost = vi.fn();
    api(
      [1],
      [
        {
          ...answered,
          preview: "First response line\nSecond response line",
          addressedToOwner: true,
          destination: {
            kind: "answer",
            postId: "post_1",
            responseId: "answer_1",
          },
        } as Notification,
      ],
    );
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={onOpenPost} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    const card = (await screen.findAllByRole("listitem"))[0]!;
    expect(card.textContent).toContain("replied to your message");
    expect(card.textContent).toContain("First response line");
    await user.click(within(card).getByRole("button"));
    expect(onOpenPost).toHaveBeenCalledWith(
      "course_1",
      "post_1",
      "#answer-answer_1",
    );
  });

  it("loads another page without discarding the first and retries after failure", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/unread-count")) return json({ data: { count: 2 } });
        if (url.includes("cursor=next")) {
          attempts += 1;
          if (attempts === 1)
            return json({ error: { message: "Try again" } }, 503);
          return json({
            data: [anonymous],
            page: { nextCursor: null, hasMore: false },
          });
        }
        if (url.startsWith("/api/v1/users/me/notifications?"))
          return json({
            data: [answered],
            page: { nextCursor: "next", hasMore: true },
          });
        throw new Error(`Unexpected ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 2 unread" }),
    );
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Try again",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("ignores a previous panel's pending Load more response after reopening", async () => {
    let resolveOldPage!: (response: Response) => void;
    let firstPages = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/unread-count"))
          return Promise.resolve(json({ data: { count: 0 } }));
        if (url.includes("cursor=old"))
          return new Promise<Response>((resolve) => {
            resolveOldPage = resolve;
          });
        if (url.startsWith("/api/v1/users/me/notifications?")) {
          firstPages += 1;
          return Promise.resolve(
            json({
              data: [firstPages === 1 ? answered : anonymous],
              page: {
                nextCursor: firstPages === 1 ? "old" : null,
                hasMore: firstPages === 1,
              },
            }),
          );
        }
        throw new Error(`Unexpected ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await user.click(bell);
    expect(
      await screen.findByText("Why does my loop never stop?"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await user.click(bell);
    await user.click(bell);
    expect(await screen.findByText("Recursion depth")).toBeTruthy();
    await act(async () => {
      resolveOldPage(
        json({ data: [answered], page: { nextCursor: "old", hasMore: true } }),
      );
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Recursion depth")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("opens the course for a scrubbed deletion card without showing deleted text", async () => {
    const onOpenPost = vi.fn();
    api(
      [1],
      [
        {
          ...answered,
          kind: "post_staff_deleted",
          postTitle: null,
          preview: null,
          actor: { displayName: "Tara TA" },
          destination: { kind: "course", courseId: "course_1" },
        },
      ],
    );
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={onOpenPost} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    const card = (await screen.findAllByRole("listitem"))[0]!;
    expect(card.textContent).toContain("Tara TA deleted your post");
    expect(card.textContent).not.toContain("Why does my loop never stop?");
    await user.click(within(card).getByRole("button"));
    expect(onOpenPost).toHaveBeenCalledWith("course_1");
  });

  it("offers retry when the initial page fails", async () => {
    let failed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/unread-count")) return json({ data: { count: 1 } });
        if (url.startsWith("/api/v1/users/me/notifications?")) {
          if (!failed) {
            failed = true;
            return json({ error: { message: "Try again" } }, 503);
          }
          return json({
            data: [answered],
            page: { nextCursor: null, hasMore: false },
          });
        }
        throw new Error(`Unexpected ${url}`);
      }),
    );
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Try again",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });

  it("explains an empty inbox", async () => {
    api([0], []);
    const user = userEvent.setup();
    render(<NotificationBell csrfToken="csrf" onOpenPost={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Notifications" }),
    );
    expect(
      await screen.findByText(/Activity on posts you follow shows up here/),
    ).toBeTruthy();
  });
});
