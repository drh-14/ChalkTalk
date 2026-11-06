import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = process.env.E2E_SCREENSHOTS_DIR
  ? resolve(process.env.E2E_SCREENSHOTS_DIR, "course-collaboration")
  : resolve(root, "test-results/browser-screenshots/course-collaboration");
let vite, origin;
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => await vite?.close());

async function mockApp(
  page,
  {
    sessions = [],
    creationError = false,
    endedSession = null,
    snapshotFailures = 0,
  } = {},
) {
  const requests = [];
  let remainingSnapshotFailures = snapshotFailures;
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/v1/sessions/current")
      return reply({
        data: {
          id: "auth",
          user: {
            id: "user-1",
            displayName: "Maya Chen",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/courses/course-1")
      return reply({
        data: { id: "course-1", name: "Calculus I", status: "active" },
      });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return reply({ data: { role: "student" } });
    if (path === "/api/v1/courses/course-1/threads/unread-count")
      return reply({ data: { unreadCount: 0 } });
    if (path === "/api/v1/courses/course-1/collaboration-sessions") {
      requests.push(req);
      if (req.method() === "POST")
        return creationError
          ? reply(
              {
                error: {
                  code: "course_archived",
                  message: "Course is not active",
                },
              },
              409,
            )
          : reply({ data: { ...sessions[0], id: "new-session" } }, 201);
      return reply({
        data: sessions,
        page: { nextCursor: null, hasMore: false },
      });
    }
    if (
      endedSession &&
      path === `/api/v1/collaboration-sessions/${endedSession.id}`
    )
      return reply({ data: endedSession });
    if (
      endedSession &&
      path === `/api/v1/collaboration-sessions/${endedSession.id}/snapshot`
    ) {
      if (remainingSnapshotFailures-- > 0)
        return reply(
          { error: { code: "snapshot_unavailable", message: "Unavailable" } },
          503,
        );
      return reply({
        data: {
          content: "last saved code",
          whiteboard: [],
          sessionStatus: "ended",
          finalSnapshotConfirmed: false,
          lastSavedWarning: true,
        },
      });
    }
    if (path === "/api/v1/notifications")
      return reply({ data: [], page: { nextCursor: null, hasMore: false } });
    return reply({ data: [], page: { nextCursor: null, hasMore: false } });
  });
  return requests;
}

const session = {
  id: "session-1",
  courseId: "course-1",
  title: "Project group planning",
  language: "python",
  status: "active",
  createdBy: "user-1",
  finalSnapshotConfirmed: null,
  participants: [
    {
      userId: "user-1",
      displayName: "Maya Chen",
      role: "creator",
      permission: "edit",
    },
  ],
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  endedAt: null,
  version: 1,
};

test("shows the course Collaboration tab, participant sessions, and a course-level creation form", async ({
  page,
}) => {
  await mockApp(page, { sessions: [session] });
  await page.goto(`${origin}/courses/course-1/collaboration`);
  const nav = page.getByRole("navigation", { name: "Course navigation" });
  await expect(
    nav.getByRole("link", { name: "Collaboration" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Project group planning")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Project group planning" }),
  ).toBeVisible();
  await expect(page.getByText("Start live session")).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "course-collaboration-list.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start live session" }).click();
  await expect(page.getByLabel("Title")).toBeVisible();
  await expect(page.getByText(/Only you and people you invite/)).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "course-collaboration-create.png"),
    fullPage: true,
  });
});

test("preserves creation input after an API failure", async ({ page }) => {
  const requests = await mockApp(page, { creationError: true });
  await page.goto(`${origin}/courses/course-1/collaboration`);
  await page.getByRole("button", { name: "Start live session" }).click();
  await page.getByLabel("Title").fill("Help with loops");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("alert")).toContainText("Course is not active");
  await expect(page.getByLabel("Title")).toHaveValue("Help with loops");
  expect(
    requests.find((request) => request.method() === "POST").postDataJSON(),
  ).toEqual({ title: "Help with loops", language: "plaintext" });
  await page.screenshot({
    path: resolve(screenshots, "course-collaboration-create-error.png"),
    fullPage: true,
  });
});

test("shows the last-saved warning for a legacy ended session", async ({
  page,
}) => {
  const ended = {
    ...session,
    id: "ended-session",
    status: "ended",
    finalSnapshotConfirmed: false,
    endedAt: "2026-11-01T12:30:00Z",
  };
  await mockApp(page, { endedSession: ended });
  await page.goto(`${origin}/courses/course-1/sessions/${ended.id}`);
  await expect(page.getByText(/Recent edits may be missing/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Collaboration" }),
  ).toHaveAttribute("href", "/courses/course-1/collaboration");
  await expect(
    page.getByRole("button", { name: "Post to discussion" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "course-collaboration-last-saved.png"),
    fullPage: true,
  });
});

test("shows an unconfirmed state and retry when the saved snapshot is unavailable", async ({
  page,
}) => {
  const ended = {
    ...session,
    id: "unavailable-snapshot-session",
    status: "ended",
    finalSnapshotConfirmed: false,
    endedAt: "2026-11-01T12:30:00Z",
  };
  await mockApp(page, { endedSession: ended, snapshotFailures: 1 });
  await page.goto(`${origin}/courses/course-1/sessions/${ended.id}`);
  await expect(page.getByText(/Saved snapshot unavailable/)).toBeVisible();
  await expect(page.getByText(/local, unconfirmed edits/)).toBeVisible();
  await expect(
    page.getByText(/^This shows the last saved version/),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "course-collaboration-snapshot-unavailable.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Retry loading saved snapshot" })
    .click();
  await expect(
    page.getByText(/This shows the last saved version/),
  ).toBeVisible();
  await expect(page.getByText(/Saved snapshot unavailable/)).toHaveCount(0);
});
