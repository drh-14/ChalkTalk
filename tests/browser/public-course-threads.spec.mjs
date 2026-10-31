import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence =
  process.env.THREADS_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/public-course-threads");
let vite;
let origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => vite?.close());

async function app(
  page,
  role = "student",
  status = "active",
  includeStaffMessage = false,
  includeReplyNotice = false,
  missingNotice = false,
  starter = false,
  secondReplyNotice = false,
) {
  const writes = [];
  const reads = [];
  let notificationUnread = 1;
  let threadUnread = 1;
  let hasChange = false;
  let staleConversationDelete = false;
  const socketMessages = [];
  let channel;
  await page.routeWebSocket("**/api/v1/thread-events", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const event = JSON.parse(raw);
      socketMessages.push(event);
      if (event.type === "subscribe")
        socket.send(
          JSON.stringify({ type: "subscribed", courseId: event.courseId }),
        );
      if (event.type === "view")
        socket.send(
          JSON.stringify({
            type: "viewing",
            conversationId: event.conversationId,
          }),
        );
    });
  });
  const boards = [
    {
      id: "board-1",
      courseId: "course-1",
      title: "Find a project team",
      version: 1,
      createdAt: "2026-10-27T12:00:00Z",
      updatedAt: "2026-10-27T12:00:00Z",
      unreadCount: 2,
    },
  ];
  const messages = [
    {
      id: "message-1",
      conversationId: "conversation-1",
      bodyMarkdown: "Looking for two teammates for the project.",
      author: starter
        ? { id: "user-1", displayName: "Alex" }
        : { id: "user-2", displayName: "Sam" },
      authorRoleAtPosting: "student",
      deleted: false,
      version: 1,
      createdAt: "2026-10-27T12:00:00Z",
      updatedAt: "2026-10-27T12:00:00Z",
      attachments: [],
    },
  ];
  if (includeStaffMessage)
    messages.push({
      ...messages[0],
      id: "message-staff",
      bodyMarkdown: "Staff guidance",
      author: { id: "user-3", displayName: "Instructor" },
      authorRoleAtPosting: "instructor",
    });
  if (includeReplyNotice)
    messages.push({
      ...messages[0],
      id: "message-reply",
      bodyMarkdown: "I can join your team after lecture.",
      author: { id: "user-3", displayName: "Pat" },
      createdAt: "2026-10-27T12:05:00Z",
      updatedAt: "2026-10-27T12:05:00Z",
    });
  const conversations = [
    {
      id: "conversation-1",
      threadId: "board-1",
      version: 1,
      canDelete: starter || role !== "student",
      openingMessage: messages[0],
      unreadCount: 1,
      createdAt: "2026-10-27T12:00:00Z",
      updatedAt: "2026-10-27T12:00:00Z",
    },
  ];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/v1/sessions/current")
      return respond({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Alex",
            email: "alex@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/users/me/notifications/unread-count")
      return respond({ data: { count: notificationUnread } });
    if (path === "/api/v1/users/me/notifications" && request.method() === "GET")
      return respond({
        data: [
          {
            id: "notice-1",
            kind: "thread_reply_created",
            courseId: "course-1",
            courseName: "Physics",
            threadId: "board-1",
            threadTitle: "Find a project team",
            conversationId: "conversation-1",
            messageId: missingNotice
              ? "message-missing"
              : includeReplyNotice
                ? "message-reply"
                : "message-1",
            preview: includeReplyNotice
              ? "I can join your team"
              : "Looking for two teammates",
            actor: { displayName: includeReplyNotice ? "Pat" : "Sam" },
            createdAt: "2026-10-27T12:00:00Z",
            readAt: null,
          },
          ...(secondReplyNotice
            ? [
                {
                  id: "notice-2",
                  kind: "thread_reply_created",
                  courseId: "course-1",
                  courseName: "Physics",
                  threadId: "board-1",
                  threadTitle: "Find a project team",
                  conversationId: "conversation-1",
                  messageId: "message-1",
                  preview: "Looking for two teammates",
                  actor: { displayName: "Sam" },
                  createdAt: "2026-10-27T12:01:00Z",
                  readAt: null,
                },
              ]
            : []),
        ],
        page: { hasMore: false, nextCursor: null },
      });
    if (
      path === "/api/v1/users/me/notifications/read" &&
      request.method() === "POST"
    ) {
      notificationUnread = 0;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/courses/course-1/members/user-1")
      return respond({ data: { role } });
    if (path === "/api/v1/courses/course-1")
      return respond({
        data: { id: "course-1", name: "Physics", status },
      });
    if (path === "/api/v1/courses/course-1/threads/unread-count")
      return respond({ data: { count: threadUnread } });
    if (
      path === "/api/v1/courses/course-1/threads/board-2" &&
      request.method() === "GET"
    )
      return respond({
        data: { ...boards[0], id: "board-2", title: "Other board" },
      });
    if (
      path === "/api/v1/courses/course-1/threads/board-1" &&
      request.method() === "DELETE"
    ) {
      writes.push({
        deleteBoard: true,
        ifMatch: request.headers()["if-match"],
      });
      boards.splice(
        boards.findIndex((item) => item.id === "board-1"),
        1,
      );
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/v1/courses/course-1/threads/changes")
      return respond({
        data: hasChange
          ? [
              {
                sequence: 1,
                boardId: "board-1",
                kind: "message_created",
                entityId: "message-1",
              },
            ]
          : [],
        page: { hasMore: false, nextCursor: hasChange ? "cursor-1" : null },
      });
    if (
      path === "/api/v1/courses/course-1/threads/board-1/conversations" &&
      request.method() === "GET"
    )
      return respond({
        data: conversations,
        page: { hasMore: false, nextCursor: null },
      });
    if (
      path ===
        "/api/v1/courses/course-1/threads/board-1/conversations/conversation-1" &&
      request.method() === "GET"
    )
      return conversations[0]
        ? respond({ data: conversations[0] })
        : respond({ error: { message: "Conversation unavailable" } }, 404);
    if (
      path ===
        "/api/v1/courses/course-1/threads/board-1/conversations/conversation-1" &&
      request.method() === "DELETE"
    ) {
      writes.push({
        deleteConversation: true,
        ifMatch: request.headers()["if-match"],
      });
      if (staleConversationDelete) {
        staleConversationDelete = false;
        conversations[0].version += 1;
        return respond({ error: { message: "Conversation has changed" } }, 412);
      }
      conversations.splice(0, 1);
      messages.splice(0);
      threadUnread = 0;
      return route.fulfill({ status: 204 });
    }
    if (
      path === "/api/v1/courses/course-1/threads/board-1/conversations" &&
      request.method() === "POST"
    ) {
      const item = {
        id: "conversation-2",
        threadId: "board-1",
        openingMessage: {
          ...messages[0],
          id: "message-2",
          conversationId: "conversation-2",
          bodyMarkdown: request.postDataJSON().bodyMarkdown,
          author: { id: "user-1", displayName: "Alex" },
        },
        unreadCount: 0,
        createdAt: messages[0].createdAt,
        updatedAt: messages[0].updatedAt,
      };
      conversations.push(item);
      messages.push(item.openingMessage);
      writes.push(request.postDataJSON());
      return respond({ data: item }, 201);
    }
    if (path.endsWith("/watch") && request.method() === "GET")
      return respond({ data: { watching: true, noticesEnabled: true } });
    if (path.endsWith("/read") && request.method() === "POST") {
      reads.push(request.postDataJSON().messageIds);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/messages") && request.method() === "GET")
      return respond({
        data: messages.filter(
          (item) => item.conversationId === path.split("/")[8],
        ),
        page: { hasMore: false, nextCursor: null },
      });
    if (
      path.endsWith("/messages/message-missing") &&
      request.method() === "GET"
    )
      return respond({ error: { message: "Message unavailable" } }, 404);
    if (path.endsWith("/messages") && request.method() === "POST") {
      const item = {
        ...messages[0],
        id: `message-${messages.length + 1}`,
        conversationId: path.split("/")[8],
        bodyMarkdown: request.postDataJSON().bodyMarkdown,
        author: { id: "user-1", displayName: "Alex" },
        attachments: [],
      };
      messages.push(item);
      writes.push(request.postDataJSON());
      return respond({ data: item }, 201);
    }
    if (path.includes("/messages/") && request.method() === "PATCH") {
      const message = messages.find(
        (item) => item.id === path.split("/").at(-1),
      );
      Object.assign(message, {
        bodyMarkdown: request.postDataJSON().bodyMarkdown,
        version: message.version + 1,
      });
      writes.push({ edit: message.id, ifMatch: request.headers()["if-match"] });
      return respond({ data: message });
    }
    if (path.includes("/messages/") && request.method() === "DELETE") {
      const message = messages.find(
        (item) => item.id === path.split("/").at(-1),
      );
      Object.assign(message, {
        bodyMarkdown: "",
        author: null,
        authorRoleAtPosting: null,
        attachments: [],
        deleted: true,
        version: message.version + 1,
      });
      writes.push({
        delete: message.id,
        ifMatch: request.headers()["if-match"],
      });
      return route.fulfill({ status: 204 });
    }
    if (
      path === "/api/v1/courses/course-1/threads" &&
      request.method() === "GET"
    )
      return respond({
        data: boards,
        page: { hasMore: false, nextCursor: null },
      });
    if (
      path === "/api/v1/courses/course-1/threads" &&
      request.method() === "POST"
    ) {
      writes.push(request.postDataJSON());
      const board = {
        ...boards[0],
        id: "board-2",
        title: request.postDataJSON().title,
        unreadCount: 0,
      };
      boards.push(board);
      return respond({ data: board }, 201);
    }
    return respond({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  await page.goto(`${origin}/courses/course-1/threads`);
  return {
    writes,
    reads,
    messages,
    socketMessages,
    emit: (value) => channel?.send(JSON.stringify(value)),
    makeNextDeleteStale: () => {
      staleConversationDelete = true;
    },
    deleteConversationRemotely: () => {
      conversations.splice(0, 1);
      messages.splice(0);
      threadUnread = 0;
      hasChange = true;
      channel?.send(
        JSON.stringify({
          type: "changed",
          courseId: "course-1",
          boardId: "board-1",
          sequence: 1,
        }),
      );
    },
    changeUnread: (count) => {
      threadUnread = count;
      hasChange = true;
      channel?.send(
        JSON.stringify({
          type: "changed",
          courseId: "course-1",
          boardId: "board-1",
          sequence: 1,
        }),
      );
    },
  };
}

test("deleted placeholders are excluded from initial and earlier read batches", async ({
  page,
}) => {
  const fixture = await app(page);
  const opening = { ...fixture.messages[0], ordinal: 1 };
  const deleted = (id, ordinal) => ({
    ...opening,
    id,
    ordinal,
    deleted: true,
    bodyMarkdown: "",
    author: null,
    authorRoleAtPosting: null,
    createdAt: `2026-10-27T12:0${ordinal}:00Z`,
    updatedAt: `2026-10-27T12:0${ordinal}:00Z`,
  });
  const earlier = [opening, deleted("message-deleted-earlier", 2)];
  const initial = [
    deleted("message-deleted", 3),
    {
      ...opening,
      id: "message-4",
      ordinal: 4,
      bodyMarkdown: "Any other teammates?",
      createdAt: "2026-10-27T12:04:00Z",
      updatedAt: "2026-10-27T12:04:00Z",
    },
  ];
  await page.route(
    "**/conversations/conversation-1/messages**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const hasCursor = new URL(route.request().url()).searchParams.has(
        "cursor",
      );
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: hasCursor ? earlier : initial,
          page: { hasMore: !hasCursor, nextCursor: hasCursor ? null : "older" },
        }),
      });
    },
  );
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect.poll(() => fixture.reads.length).toBeGreaterThan(0);
  expect(fixture.reads[0]).toEqual(["message-4"]);
  await expect(page.locator("#thread-message-message-deleted")).toBeVisible();
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(
    page.locator("#thread-message-message-deleted-earlier"),
  ).toBeVisible();
  await expect.poll(() => fixture.reads.length).toBe(2);
  expect(fixture.reads).toEqual([["message-4"], ["message-1"]]);
});

test("archived earlier pages do not write read state", async ({ page }) => {
  const fixture = await app(page, "student", "archived");
  const opening = { ...fixture.messages[0], ordinal: 1 };
  const recent = {
    ...opening,
    id: "message-recent",
    ordinal: 2,
    bodyMarkdown: "Following up on the team search.",
    createdAt: "2026-10-27T12:02:00Z",
    updatedAt: "2026-10-27T12:02:00Z",
  };
  await page.route(
    "**/conversations/conversation-1/messages**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const earlier = new URL(route.request().url()).searchParams.has("cursor");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: earlier ? [opening] : [recent],
          page: { hasMore: !earlier, nextCursor: earlier ? null : "older" },
        }),
      });
    },
  );
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.locator("#thread-message-message-1")).toBeVisible();
  expect(fixture.reads).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("course Threads tab lists public topic boards and lets staff create one", async ({
  page,
}) => {
  const { writes } = await app(page, "ta");
  const navigation = page.getByRole("navigation", {
    name: "Course navigation",
  });
  await expect(navigation.getByRole("link")).toHaveText([
    "Discussion",
    /^Threads\d*$/,
    "Course resources",
    "Course settings",
    "Statistics",
  ]);
  await expect(
    navigation.getByRole("link", { name: "Threads" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Find a project team" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create thread" }).click();
  await expect(page.getByRole("button", { name: "Create thread" })).toHaveClass(
    /button primary/,
  );
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveClass(
    /button secondary/,
  );
  await expect(page.getByRole("button", { name: "Create thread" })).toHaveCSS(
    "padding-left",
    "16px",
  );
  await page.getByLabel("Thread title").fill("Study partners");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Study partners" }),
  ).toBeVisible();
  expect(writes).toEqual([{ title: "Study partners" }]);
  await page.screenshot({
    path: resolve(evidence, "boards-and-staff-creation.png"),
    fullPage: true,
  });
});

test("board title accepts API-valid Unicode code-point lengths and rejects overlong input", async ({
  page,
}) => {
  const fixture = await app(page, "ta");
  await page.getByRole("button", { name: "Create thread" }).click();
  const valid = "Team " + "😀".repeat(130);
  await page.getByLabel("Thread title").fill(valid);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: valid })).toBeVisible();
  expect(fixture.writes).toContainEqual({ title: valid });
  await page.getByRole("button", { name: "Create thread" }).click();
  await page.getByLabel("Thread title").fill("x".repeat(201));
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "between 1 and 200 characters",
  );
  expect(fixture.writes).toHaveLength(1);
  await page.screenshot({
    path: resolve(evidence, "thread-title-boundary.png"),
    fullPage: true,
  });
});

test("students can open a public board, start a conversation and reply without board controls", async ({
  page,
}) => {
  const { writes } = await app(page);
  await expect(page.getByRole("button", { name: "Create thread" })).toHaveCount(
    0,
  );
  await page.getByRole("heading", { name: "Find a project team" }).click();
  await expect(
    page.getByRole("heading", { name: "Find a project team" }),
  ).toBeVisible();
  await expect(page.getByText("Attach file")).toHaveCount(0);
  await expect(page.locator('.threads-area input[type="file"]')).toHaveCount(0);
  await page.getByLabel("Start a conversation").fill("I can help with the UI.");
  await page.getByRole("button", { name: "Post conversation" }).click();
  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();
  await expect(page.getByText("Attach file")).toHaveCount(0);
  await expect(page.locator('.threads-area input[type="file"]')).toHaveCount(0);
  await page.getByLabel("Reply").fill("Let's meet after class.");
  await page.getByRole("button", { name: "Reply" }).click();
  await expect(
    page
      .locator(".threads-message")
      .filter({ hasText: "I can help with the UI." }),
  ).toBeVisible();
  await expect(
    page
      .locator(".threads-message")
      .filter({ hasText: "Let's meet after class." }),
  ).toBeVisible();
  expect(writes).toEqual([
    { bodyMarkdown: "I can help with the UI." },
    { bodyMarkdown: "Let's meet after class." },
  ]);
  await page.screenshot({
    path: resolve(evidence, "conversation-and-reply.png"),
    fullPage: true,
  });
});

test("archived course keeps Threads readable but hides mutation controls", async ({
  page,
}) => {
  await app(page, "ta", "archived");
  await page.getByRole("heading", { name: "Find a project team" }).click();
  await expect(
    page.getByText("This course is archived. Threads are read-only."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create thread" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Start a conversation")).toHaveCount(0);
  await page.screenshot({
    path: resolve(evidence, "archived-read-only.png"),
    fullPage: true,
  });
});

test("direct links open a board outside the first list page", async ({
  page,
}) => {
  await app(page);
  await page.goto(`${origin}/courses/course-1/threads/board-2`);
  await expect(
    page.getByRole("heading", { name: "Other board" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "direct-board-link.png"),
    fullPage: true,
  });
});

test("reply typing uses a live WebSocket and stays in the open conversation", async ({
  page,
}) => {
  const live = await app(page);
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect
    .poll(() =>
      live.socketMessages.some(
        (item) =>
          item.type === "view" && item.conversationId === "conversation-1",
      ),
    )
    .toBe(true);
  live.emit({
    type: "typing",
    conversationId: "conversation-1",
    userId: "user-2",
    displayName: "Sam",
    active: true,
  });
  await expect(page.getByText("Sam is typing…")).toBeVisible();
  live.emit({
    type: "typing",
    conversationId: "another-conversation",
    userId: "user-3",
    displayName: "Pat",
    active: true,
  });
  await expect(page.getByText(/Pat.*typing/)).toHaveCount(0);
  await page.getByLabel("Reply").fill("I am available tomorrow");
  await expect
    .poll(() =>
      live.socketMessages.some(
        (item) =>
          item.type === "typing" &&
          item.active === true &&
          item.conversationId === "conversation-1",
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: resolve(evidence, "live-typing.png"),
    fullPage: true,
  });
  live.emit({
    type: "typing",
    conversationId: "conversation-1",
    userId: "user-2",
    displayName: "Sam",
    active: false,
  });
  await expect(page.getByText("Sam is typing…")).toHaveCount(0);
});

test("Thread reply notification opens and focuses its exact message", async ({
  page,
}) => {
  await app(page, "student", "active", false, true);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(
    page.getByRole("button", { name: /Pat replied in/ }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "bell-thread-reply-card.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Pat replied in/ }).click();
  await expect(page).toHaveURL(
    /\/threads\/board-1\/conversations\/conversation-1\?notificationId=notice-1#thread-message-message-reply$/,
  );
  await expect(page.locator("#thread-message-message-reply")).toContainText(
    "I can join your team",
  );
  await expect(page.locator("#thread-message-message-reply")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "bell-exact-thread-reply.png"),
    fullPage: true,
  });
});

test("a durable WebSocket signal updates the course Threads unread badge", async ({
  page,
}) => {
  const live = await app(page);
  const tab = page
    .getByRole("navigation", { name: "Course navigation" })
    .getByRole("link", { name: /Threads/ });
  await expect(tab).toContainText("1");
  await expect
    .poll(() => live.socketMessages.some((item) => item.type === "subscribe"))
    .toBe(true);
  live.changeUnread(3);
  await expect(tab).toContainText("3");
  await page.screenshot({
    path: resolve(evidence, "live-unread-badge.png"),
    fullPage: true,
  });
});

test("a live reply remains unread until the conversation is opened again", async ({
  page,
}) => {
  const live = await app(page);
  const conversationUrl = `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`;
  await page.goto(conversationUrl);
  await expect.poll(() => live.reads.length).toBeGreaterThan(0);
  expect(live.reads).toEqual([["message-1"]]);
  live.messages.push({
    ...live.messages[0],
    id: "message-live-reply",
    bodyMarkdown: "New reply while this conversation is open",
    createdAt: "2026-10-27T12:10:00Z",
    updatedAt: "2026-10-27T12:10:00Z",
  });
  live.changeUnread(3);
  await expect(
    page.locator("#thread-message-message-live-reply"),
  ).toContainText("New reply");
  await expect(
    page
      .getByRole("navigation", { name: "Course navigation" })
      .getByRole("link", { name: /Threads/ }),
  ).toContainText("3");
  expect(live.reads).toEqual([["message-1"]]);
  await page.screenshot({
    path: resolve(evidence, "live-reply-still-unread.png"),
    fullPage: true,
  });
  await page.goto(`${origin}/courses/course-1/threads`);
  await page.goto(conversationUrl);
  await expect
    .poll(() => live.reads.some((ids) => ids.includes("message-live-reply")))
    .toBe(true);
});

test("Refresh retries a failed opening read without reading a later live reply", async ({
  page,
}) => {
  const live = await app(page);
  const attempts = [];
  await page.route("**/conversations/conversation-1/read", async (route) => {
    attempts.push(route.request().postDataJSON().messageIds);
    if (attempts.length === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Read state temporarily unavailable" },
        }),
      });
    return route.fallback();
  });
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect(page.getByRole("alert")).toContainText(
    "Read state temporarily unavailable",
  );
  expect(attempts).toEqual([["message-1"]]);
  live.messages.push({
    ...live.messages[0],
    id: "message-after-failure",
    bodyMarkdown: "Arrived after the opening read failed",
    createdAt: "2026-10-27T12:15:00Z",
    updatedAt: "2026-10-27T12:15:00Z",
  });
  live.changeUnread(3);
  await expect(
    page.locator("#thread-message-message-after-failure"),
  ).toBeVisible();
  expect(attempts).toEqual([["message-1"]]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts).toEqual([["message-1"], ["message-1"]]);
  expect(live.reads).toEqual([["message-1"]]);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({
    path: resolve(evidence, "opening-read-retry.png"),
    fullPage: true,
  });
});

test("a changed signal during in-flight catch-up queues another authoritative read", async ({
  page,
}) => {
  const live = await app(page);
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  await page.route("**/threads/changes**", async (route) => {
    calls += 1;
    if (calls === 1) {
      await gate;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          page: { hasMore: false, nextCursor: null },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            sequence: 1,
            boardId: "board-1",
            kind: "message_created",
            entityId: "message-1",
          },
        ],
        page: { hasMore: false, nextCursor: "cursor-1" },
      }),
    });
  });
  await page.reload();
  await expect.poll(() => calls).toBe(1);
  live.changeUnread(3);
  releaseFirst();
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(
    page
      .getByRole("navigation", { name: "Course navigation" })
      .getByRole("link", { name: /Threads/ }),
  ).toContainText("3");
  await page.screenshot({
    path: resolve(evidence, "catch-up-race-recovered.png"),
    fullPage: true,
  });
});

test("catch-up retries unapplied changes without advancing its durable cursor", async ({
  page,
}) => {
  const live = await app(page);
  await expect(
    page.getByRole("heading", { name: "Find a project team" }),
  ).toBeVisible();
  const afterValues = [];
  await page.route("**/threads/changes**", async (route) => {
    afterValues.push(new URL(route.request().url()).searchParams.get("after"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            sequence: 1,
            boardId: "board-1",
            kind: "message_created",
            entityId: "message-1",
          },
        ],
        page: { hasMore: false, nextCursor: "cursor-1" },
      }),
    });
  });
  let failRefresh = true;
  await page.route("**/courses/course-1/threads", async (route) => {
    if (route.request().method() !== "GET" || !failRefresh)
      return route.fallback();
    failRefresh = false;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Temporarily unavailable" } }),
    });
  });
  live.changeUnread(2);
  await expect(page.getByRole("alert")).toContainText(
    "Temporarily unavailable",
  );
  expect(
    await page.evaluate(() =>
      globalThis.sessionStorage.getItem("chalktalk-thread-cursor:course-1"),
    ),
  ).toBeNull();
  live.changeUnread(3);
  await expect.poll(() => afterValues.length).toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.sessionStorage.getItem("chalktalk-thread-cursor:course-1"),
      ),
    )
    .toBe("cursor-1");
  expect(afterValues.slice(0, 2)).toEqual([null, null]);
});

test("catch-up consumes all pages before storing the cursor", async ({
  page,
}) => {
  const live = await app(page);
  let pages = 0;
  await page.route("**/threads/changes**", async (route) => {
    pages += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            sequence: pages,
            boardId: "board-1",
            kind: "message_created",
            entityId: "message-1",
          },
        ],
        page: { hasMore: pages < 101, nextCursor: `cursor-${pages}` },
      }),
    });
  });
  live.changeUnread(2);
  await expect.poll(() => pages).toBe(101);
  await expect
    .poll(() =>
      page.evaluate(() =>
        globalThis.sessionStorage.getItem("chalktalk-thread-cursor:course-1"),
      ),
    )
    .toBe("cursor-101");
});

test("a missing notification target stays unread instead of being silently dismissed", async ({
  page,
}) => {
  await app(page, "student", "active", false, false, true);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: /Sam replied in/ }).click();
  await expect(page.getByRole("alert")).toContainText("Message unavailable");
  await expect(
    page.getByRole("button", { name: "Notifications, 1 unread" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "missing-notification-target.png"),
    fullPage: true,
  });
});

test("an off-page notification reply is fetched, marked read, focused, then clears its notice", async ({
  page,
}) => {
  const fixture = await app(page, "student", "active", false, true);
  let exactRequests = 0;
  const opening = {
    id: "message-1",
    ordinal: 1,
    conversationId: "conversation-1",
    bodyMarkdown: "Looking for two teammates for the project.",
    author: { id: "user-2", displayName: "Sam" },
    authorRoleAtPosting: "student",
    deleted: false,
    version: 1,
    createdAt: "2026-10-27T12:00:00Z",
    updatedAt: "2026-10-27T12:00:00Z",
    attachments: [],
  };
  await page.route("**/conversations/conversation-1/messages", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            ...opening,
            id: "message-later",
            ordinal: 3,
            bodyMarkdown: "We have one spot left.",
            createdAt: "2026-10-27T12:10:00Z",
            updatedAt: "2026-10-27T12:10:00Z",
          },
        ],
        page: { hasMore: true, nextCursor: "older" },
      }),
    }),
  );
  await page.route("**/messages/message-reply", (route) => {
    exactRequests += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...opening,
          id: "message-reply",
          ordinal: 2,
          bodyMarkdown: "I can join your team after lecture.",
          author: { id: "user-3", displayName: "Pat" },
          createdAt: "2026-10-27T12:05:00Z",
          updatedAt: "2026-10-27T12:05:00Z",
        },
      }),
    });
  });
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: /Pat replied in/ }).click();
  await expect.poll(() => exactRequests).toBeGreaterThan(0);
  await expect
    .poll(() => fixture.reads.flat().includes("message-reply"))
    .toBe(true);
  await expect(page.locator("#thread-message-message-reply")).toContainText(
    "I can join your team",
  );
  await expect(page.locator("#thread-message-message-reply")).toBeFocused();
  await expect
    .poll(() => fixture.reads.flat().includes("message-reply"))
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "off-page-reply-target.png"),
    fullPage: true,
  });
});

test("a second exact reply destination in the same conversation receives focus", async ({
  page,
}) => {
  await app(page, "student", "active", false, true, false, false, true);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: /Pat replied in/ }).click();
  await expect(page.locator("#thread-message-message-reply")).toBeFocused();
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: /Sam replied in/ }).click();
  await expect(page).toHaveURL(
    /notificationId=notice-2#thread-message-message-1$/,
  );
  await expect(page.locator("#thread-message-message-1")).toBeFocused();
  await page.screenshot({
    path: resolve(evidence, "same-conversation-second-reply-target.png"),
    fullPage: true,
  });
});

test("failed exact-message lookup can retry without clearing its notice", async ({
  page,
}) => {
  await app(page, "student", "active", false, true);
  const opening = {
    id: "message-1",
    conversationId: "conversation-1",
    bodyMarkdown: "Looking for teammates",
    author: { id: "user-2", displayName: "Sam" },
    deleted: false,
    version: 1,
    createdAt: "2026-10-27T12:00:00Z",
    updatedAt: "2026-10-27T12:00:00Z",
    attachments: [],
  };
  await page.route("**/conversations/conversation-1/messages", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [opening],
        page: { hasMore: false, nextCursor: null },
      }),
    }),
  );
  let attempts = 0;
  await page.route("**/messages/message-reply", (route) => {
    attempts += 1;
    return route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts === 1
          ? { error: { message: "Message temporarily unavailable" } }
          : {
              data: {
                ...opening,
                id: "message-reply",
                bodyMarkdown: "I can join your team after lecture.",
              },
            },
      ),
    });
  });
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.getByRole("button", { name: /Pat replied in/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Message temporarily unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Notifications, 1 unread" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.locator("#thread-message-message-reply")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "reply-target-retry.png"),
    fullPage: true,
  });
});

test("existing attachment remains downloadable without an upload control", async ({
  page,
}) => {
  const fixture = await app(
    page,
    "student",
    "active",
    false,
    false,
    false,
    true,
  );
  fixture.messages[0].attachments.push({
    id: "attachment-existing",
    fileName: "notes.txt",
    mediaType: "text/plain",
    sizeBytes: 5,
    downloadUrl: "/api/v1/thread-attachments/attachment-existing/download",
    createdAt: "2026-10-27T12:00:00Z",
  });
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  const message = page.locator(".threads-message").first();
  const link = message.getByRole("link", { name: "notes.txt" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    "/api/v1/thread-attachments/attachment-existing/download",
  );
  await expect(page.getByText("Attach file")).toHaveCount(0);
  await expect(page.locator('.threads-area input[type="file"]')).toHaveCount(0);
  await page.getByLabel("Reply").fill("A reply without a new attachment.");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const replyMessage = page
    .locator(".threads-message")
    .filter({ hasText: "A reply without a new attachment." });
  await expect(replyMessage).toBeVisible();
  await expect(
    replyMessage.getByRole("link", { name: "notes.txt" }),
  ).toHaveCount(0);
  await expect(page.getByText("Attach file")).toHaveCount(0);
  await expect(page.locator('.threads-area input[type="file"]')).toHaveCount(0);
  await page.route(
    "**/api/v1/thread-attachments/attachment-existing/download",
    (route) =>
      route.fulfill({
        body: "hello",
        contentType: "text/plain",
        headers: {
          "Content-Disposition": 'attachment; filename="notes.txt"',
        },
      }),
  );
  await page.screenshot({
    path: resolve(evidence, "existing-attachment.png"),
    fullPage: true,
  });
  const download = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  expect(download[0].suggestedFilename()).toBe("notes.txt");
});

test("staff may moderate student messages but not another staff member's message", async ({
  page,
}) => {
  const fixture = await app(page, "ta", "active", true);
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  const studentMessage = page.locator("#thread-message-message-1");
  const staffMessage = page.locator("#thread-message-message-staff");
  await expect(
    studentMessage.getByRole("button", { name: "Edit" }),
  ).toBeVisible();
  await expect(staffMessage.getByRole("button", { name: "Edit" })).toHaveCount(
    0,
  );
  await studentMessage.getByRole("button", { name: "Edit" }).click();
  await studentMessage.getByLabel("Edit message").fill("Updated team request");
  await studentMessage.getByRole("button", { name: "Save edit" }).click();
  await expect(studentMessage).toContainText("Updated team request");
  page.once("dialog", (dialog) => dialog.accept());
  await studentMessage.getByRole("button", { name: "Delete" }).click();
  await expect(studentMessage).toContainText("Message deleted");
  expect(fixture.writes).toEqual([
    { edit: "message-1", ifMatch: '"v1"' },
    { delete: "message-1", ifMatch: '"v2"' },
  ]);
  await page.screenshot({
    path: resolve(evidence, "moderated-message-tombstone.png"),
    fullPage: true,
  });
});

test("staff board deletion requires confirmation and returns to the Thread list", async ({
  page,
}) => {
  const fixture = await app(page, "instructor");
  await page.getByRole("heading", { name: "Find a project team" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete thread" }).click();
  await expect(
    page.getByRole("heading", { name: "Find a project team" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete thread" }).click();
  await expect(page).toHaveURL(/\/courses\/course-1\/threads$/);
  await expect(page.getByText("No threads yet.")).toBeVisible();
  expect(fixture.writes).toEqual([{ deleteBoard: true, ifMatch: '"v1"' }]);
  await page.screenshot({
    path: resolve(evidence, "board-deleted.png"),
    fullPage: true,
  });
});

test("conversation starter confirms whole-conversation deletion", async ({
  page,
}) => {
  const fixture = await app(
    page,
    "student",
    "active",
    false,
    false,
    false,
    true,
  );
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  const button = page.getByRole("button", { name: "Delete conversation" });
  await expect(button).toBeVisible();
  const unfollow = page.getByRole("button", { name: "Unfollow notifications" });
  await expect(unfollow).toBeVisible();
  const deleteBox = await button.boundingBox();
  const unfollowBox = await unfollow.boundingBox();
  expect(
    unfollowBox.x - (deleteBox.x + deleteBox.width),
  ).toBeGreaterThanOrEqual(10);
  page.once("dialog", (dialog) => dialog.dismiss());
  await button.click();
  await expect(
    page.getByText("Looking for two teammates for the project."),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "conversation-delete-cancel.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await button.click();
  await expect(page).toHaveURL(/\/courses\/course-1\/threads\/board-1$/);
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  expect(fixture.writes).toEqual([
    { deleteConversation: true, ifMatch: '"v1"' },
  ]);
  await page.screenshot({
    path: resolve(evidence, "conversation-deleted.png"),
    fullPage: true,
  });
});

test("staff can delete a student's conversation but another student cannot", async ({
  page,
}) => {
  await app(page);
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect(
    page.getByRole("button", { name: "Delete conversation" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(evidence, "conversation-delete-denied.png"),
    fullPage: true,
  });
  const staffPage = await page.context().newPage();
  const fixture = await app(staffPage, "ta");
  await staffPage.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect(
    staffPage.getByRole("button", { name: "Delete conversation" }),
  ).toBeVisible();
  staffPage.once("dialog", (dialog) => dialog.accept());
  await staffPage.getByRole("button", { name: "Delete conversation" }).click();
  await expect(staffPage).toHaveURL(/\/courses\/course-1\/threads\/board-1$/);
  expect(fixture.writes).toEqual([
    { deleteConversation: true, ifMatch: '"v1"' },
  ]);
  await staffPage.screenshot({
    path: resolve(evidence, "staff-conversation-deleted.png"),
    fullPage: true,
  });
});

test("a stale conversation delete refreshes instead of removing newer replies", async ({
  page,
}) => {
  const fixture = await app(
    page,
    "student",
    "active",
    false,
    false,
    false,
    true,
  );
  fixture.makeNextDeleteStale();
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete conversation" }).click();
  await expect(page).toHaveURL(/\/conversations\/conversation-1$/);
  await expect(page.getByRole("alert")).toContainText("changed");
  await expect(
    page.getByText("Looking for two teammates for the project."),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "conversation-delete-stale.png"),
    fullPage: true,
  });
});

test("a live deletion closes another viewer's now-missing conversation", async ({
  page,
}) => {
  const fixture = await app(page);
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await expect(
    page.getByText("Looking for two teammates for the project."),
  ).toBeVisible();
  fixture.deleteConversationRemotely();
  await expect(page).toHaveURL(/\/courses\/course-1\/threads\/board-1$/);
  await expect(page.getByText("No conversations yet.")).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "conversation-removed-live.png"),
    fullPage: true,
  });
});

async function trackThreadPosts(page, suffix, failures = 2) {
  const keys = [];
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    if (
      request.method() !== "POST" ||
      !new URL(request.url()).pathname.endsWith(suffix)
    )
      return route.fallback();
    keys.push(request.headers()["idempotency-key"]);
    if (keys.length <= failures) return route.abort("failed");
    return route.fallback();
  });
  return keys;
}

test("board creation retries unchanged and rotates edited and new submissions", async ({
  page,
}) => {
  await app(page, "ta");
  const keys = await trackThreadPosts(page, "/threads");
  await page.getByRole("button", { name: "Create thread" }).click();
  await page.getByLabel("Thread title").fill("First board");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Thread title").fill("Edited board");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(keys[1]).not.toBe(keys[0]);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create thread" }),
  ).toBeVisible();
  expect(keys[2]).toBe(keys[1]);
  await page.getByRole("button", { name: "Create thread" }).click();
  await page.getByLabel("Thread title").fill("Second board");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect.poll(() => keys.length).toBe(4);
  expect(keys[3]).not.toBe(keys[2]);
  await page.screenshot({
    path: resolve(evidence, "thread-board-retry.png"),
    fullPage: true,
  });
});

test("conversation creation retries unchanged and rotates edited text", async ({
  page,
}) => {
  await app(page);
  const keys = await trackThreadPosts(page, "/conversations");
  await page.getByRole("heading", { name: "Find a project team" }).click();
  await page.getByLabel("Start a conversation").fill("First draft");
  await page.getByRole("button", { name: "Post conversation" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Start a conversation").fill("Edited draft");
  await page.getByRole("button", { name: "Post conversation" }).click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(keys[1]).not.toBe(keys[0]);
  await page.getByRole("button", { name: "Post conversation" }).click();
  await expect(
    page.getByRole("heading", { name: "Conversation" }),
  ).toBeVisible();
  expect(keys[2]).toBe(keys[1]);
  await page.goto(`${origin}/courses/course-1/threads/board-1`);
  await page.getByLabel("Start a conversation").fill("Second draft");
  await page.getByRole("button", { name: "Post conversation" }).click();
  await expect.poll(() => keys.length).toBe(4);
  expect(keys[3]).not.toBe(keys[2]);
  await page.screenshot({
    path: resolve(evidence, "thread-conversation-retry.png"),
    fullPage: true,
  });
});

test("reply creation retries unchanged and rotates edited text", async ({
  page,
}) => {
  await app(page);
  const keys = await trackThreadPosts(page, "/messages");
  await page.goto(
    `${origin}/courses/course-1/threads/board-1/conversations/conversation-1`,
  );
  await page.getByLabel("Reply").fill("First reply");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Reply").fill("Edited reply");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.poll(() => keys.length).toBe(2);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(keys[1]).not.toBe(keys[0]);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(
    page.locator(".threads-message").filter({ hasText: "Edited reply" }),
  ).toBeVisible();
  expect(keys[2]).toBe(keys[1]);
  await page.getByLabel("Reply").fill("Second reply");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.poll(() => keys.length).toBe(4);
  expect(keys[3]).not.toBe(keys[2]);
  await page.screenshot({
    path: resolve(evidence, "thread-reply-retry.png"),
    fullPage: true,
  });
});

test("Threads action buttons use compact dimensions and retain focus", async ({
  page,
}) => {
  await app(page, "ta");
  const boardAction = page.getByRole("button", { name: "Create thread" });
  await expect(boardAction).toBeVisible();
  const boardMetrics = await boardAction.evaluate((element) => ({
    minHeight:
      element.ownerDocument.defaultView.getComputedStyle(element).minHeight,
    paddingTop:
      element.ownerDocument.defaultView.getComputedStyle(element).paddingTop,
    paddingLeft:
      element.ownerDocument.defaultView.getComputedStyle(element).paddingLeft,
  }));
  expect(boardMetrics.minHeight).toBe("38.4px");
  expect(boardMetrics.paddingTop).toBe("10.88px");
  expect(boardMetrics.paddingLeft).toBe("16px");
  await page.locator(".threads-card").last().focus();
  await page.keyboard.press("Tab");
  await expect(boardAction).toBeFocused();
  await expect(boardAction).toHaveCSS("outline-style", "solid");
  await page.route("**/api/v1/courses/course-1/threads", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Threads unavailable" } }),
    });
  });
  await page.getByRole("button", { name: "Refresh" }).click();
  const retryAction = page.getByRole("button", { name: "Try again" });
  await expect(retryAction).toBeVisible();
  await expect(retryAction).toHaveCSS("min-height", "0px");
  await expect(retryAction).toHaveCSS("padding-top", "6.08px");
  await expect(retryAction).toHaveCSS("padding-left", "12.8px");
  expect((await retryAction.boundingBox()).height).toBeLessThan(32);
  await page.keyboard.press("Tab");
  await expect(retryAction).toBeFocused();
  await expect(retryAction).toHaveCSS("outline-style", "solid");
  await page.screenshot({
    path: resolve(evidence, "compact-retry-action.png"),
    fullPage: true,
  });
  await page.unroute("**/api/v1/courses/course-1/threads");
  await page.goto(`${origin}/courses/course-1/threads/board-1`);
  const secondaryAction = page.getByRole("button", { name: "Rename thread" });
  const dangerAction = page.getByRole("button", { name: "Delete thread" });
  for (const action of [secondaryAction, dangerAction]) {
    await expect(action).toHaveCSS("min-height", "38.4px");
    await expect(action).toHaveCSS("padding-left", "16px");
  }
  await expect(secondaryAction).toHaveCSS(
    "background-color",
    "rgb(233, 238, 229)",
  );
  await expect(dangerAction).toHaveCSS(
    "background-color",
    "rgb(255, 240, 237)",
  );
  await secondaryAction.focus();
  await page.keyboard.press("Tab");
  await expect(dangerAction).toBeFocused();
  await expect(dangerAction).toHaveCSS("outline-style", "solid");
  const conversationAction = page.getByRole("button", {
    name: "Post conversation",
  });
  await expect(conversationAction).toHaveCSS("min-height", "38.4px");
  await page.screenshot({
    path: resolve(evidence, "compact-actions.png"),
    fullPage: true,
  });
});
