import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = process.env.E2E_SCREENSHOTS_DIR
  ? resolve(process.env.E2E_SCREENSHOTS_DIR, "course-pages")
  : resolve(root, "test-results/browser-screenshots/course-pages");
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

const author = {
  userId: "ta-1",
  displayName: "Zeyu Yang",
  anonymous: false,
  deleted: false,
};
const post = (id, title, lastActivityAt, extra = {}) => ({
  id,
  courseId: "course-1",
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: `Details about ${title.toLowerCase()}.`,
  author,
  anonymous: false,
  tags: ["hw7"],
  answered: true,
  createdAt: lastActivityAt,
  lastActivityAt,
  version: 1,
  ...extra,
});
const posts = [
  post("p1", "Course rules", "2026-10-01T12:00:00", {
    type: "note",
    pinned: true,
  }),
  post("t1", "Is the final cumulative?", "2026-11-05T09:00:00"),
  post("y1", "Red black trees", "2026-11-04T09:00:00"),
  post("w1", "Inserting into b-trees", "2026-11-02T09:00:00"),
  post("l1", "Heap sort runtime", "2026-10-27T09:00:00"),
  post("o1", "Hash table resizing", "2026-10-14T09:00:00"),
];

async function mockApp(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data) =>
      route.fulfill({
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
        data: {
          id: "course-1",
          name: "CSE 214-01 Data Structures",
          status: "active",
        },
      });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return reply({ data: { role: "instructor" } });
    if (path === "/api/v1/courses/course-1/posts")
      return reply({
        data: posts,
        page: { nextCursor: null, hasMore: false },
      });
    if (path === "/api/v1/courses/course-1/threads/unread-count")
      return reply({ data: { unreadCount: 0 } });
    return reply({ data: [], page: { nextCursor: null, hasMore: false } });
  });
}

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport, ignoreHTTPSErrors: true });

    test("the feed groups posts into collapsible pinned and week sections", async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-11-05T12:00:00"));
      await mockApp(page);
      await page.goto(`${origin}/courses/course-1`);
      const headings = page.locator(".feed-section-heading button");
      await expect(headings).toHaveText([
        "Pinned1",
        "Today1",
        "Yesterday1",
        "Earlier this week1",
        "Last week1",
        "Week of Oct 11 – Oct 171",
      ]);
      const lastWeek = page.getByRole("button", { name: /^Last week/ });
      await lastWeek.click();
      await expect(lastWeek).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByText("Heap sort runtime", { exact: true }),
      ).toHaveCount(0);
      await lastWeek.click();
      await expect(
        page.getByText("Heap sort runtime", { exact: true }),
      ).toBeVisible();
      if (size === "desktop")
        await expect(
          page.getByRole("heading", { name: "Select a post" }),
        ).toBeVisible();
      await page.screenshot({
        path: resolve(screenshots, `${size}-feed-sections.png`),
      });
    });

    test("the app bar is one row with an account menu", async ({ page }) => {
      await mockApp(page);
      await page.goto(`${origin}/courses/course-1`);
      const banner = page.getByRole("banner");
      await expect(
        banner.getByRole("heading", { name: "CSE 214-01 Data Structures" }),
      ).toBeVisible();
      if (size === "desktop") {
        const bar = await banner.boundingBox();
        expect(bar.height).toBeLessThan(60);
      }
      await expect(
        banner.getByRole("button", { name: "Sign out" }),
      ).toHaveCount(0);
      const menu = banner.getByRole("button", {
        name: "Account menu for Maya Chen",
      });
      await menu.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(banner.getByText("maya@example.edu")).toBeVisible();
      await expect(
        banner.getByRole("link", { name: "Account settings" }),
      ).toBeVisible();
      await expect(
        banner.getByRole("button", { name: "Sign out" }),
      ).toBeVisible();
      await page.screenshot({
        path: resolve(screenshots, `${size}-account-menu.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        banner.getByRole("button", { name: "Sign out" }),
      ).toHaveCount(0);
    });

    test("Threads and Collaboration share the page frame and empty states", async ({
      page,
    }) => {
      await mockApp(page);
      await page.goto(`${origin}/courses/course-1`);
      await page
        .getByRole("link", { name: "Threads", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "No threads yet" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Open conversations for the whole course, updated live.",
        ),
      ).toBeVisible();
      const createThread = page.getByRole("button", { name: "Create thread" });
      await expect(createThread).toBeVisible();
      const threadsTitle = await page
        .getByRole("heading", { name: "Threads", exact: true })
        .boundingBox();
      const threadsButton = await createThread.boundingBox();
      await page.screenshot({
        path: resolve(screenshots, `${size}-threads-empty.png`),
      });
      await page
        .getByRole("link", { name: "Collaboration", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "No collaboration sessions yet" }),
      ).toBeVisible();
      const collabTitle = await page
        .getByRole("heading", { name: "Collaboration", exact: true })
        .boundingBox();
      const startSession = await page
        .getByRole("button", { name: "Start live session" })
        .boundingBox();
      expect(Math.round(collabTitle.x)).toBe(Math.round(threadsTitle.x));
      expect(Math.round(startSession.height)).toBe(
        Math.round(threadsButton.height),
      );
      await page.screenshot({
        path: resolve(screenshots, `${size}-collaboration-empty.png`),
      });
    });
  });
}
