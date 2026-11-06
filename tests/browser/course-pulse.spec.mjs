import { mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const evidence =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/course-pulse");
let vite, origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => {
  await vite?.close();
});

const hours = Array.from({ length: 7 }, (_, day) =>
  Array.from({ length: 24 }, (_, hour) =>
    hour >= 9 && hour <= 22
      ? ((day * 7 + hour * 3) % 5) + (day === 2 ? 2 : 0)
      : 0,
  ),
);
hours[2][10] = 9;
const pulse = {
  courseId: "course-1",
  timeZone: "America/New_York",
  firstQuestionAt: "2024-08-29T14:00:00Z",
  lastQuestionAt: "2024-12-19T18:00:00Z",
  questions: 71,
  answered: 62,
  unanswered: 9,
  medianFirstAnswerMinutes: 66,
  hours,
  weeks: Array.from({ length: 17 }, (_, index) => ({
    weekStart: new Date(Date.UTC(2024, 7, 25 + index * 7))
      .toISOString()
      .slice(0, 10),
    questions:
      index === 16
        ? 12
        : [1, 3, 5, 6, 5, 1, 3, 3, 0, 2, 4, 5, 1, 6, 4, 0][index],
  })),
  topics: [
    { tag: "hw7", questions: 24, unanswered: 0, medianFirstAnswerMinutes: 378 },
    { tag: "hw2", questions: 12, unanswered: 2, medianFirstAnswerMinutes: 21 },
    { tag: "hw1", questions: 11, unanswered: 2, medianFirstAnswerMinutes: 60 },
  ],
  helpers: [
    { userId: "s1", displayName: "Arsalan", role: "student", answers: 17 },
    { userId: "t1", displayName: "Kevin Darby", role: "ta", answers: 13 },
  ],
  generatedAt: "2026-11-06T14:30:00Z",
};
const post = (id, title) => ({
  id,
  courseId: "course-1",
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: "How should we read this part of the assignment?",
  author: {
    userId: "s1",
    displayName: "Ada",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: ["hw7"],
  answered: true,
  pinned: false,
  unread: false,
  createdAt: "2026-11-05T14:00:00Z",
  lastActivityAt: "2026-11-05T14:00:00Z",
  version: 1,
});

/** Mocks the API for a TA; `slow` holds the named responses until each promise settles. */
async function mockApi(page, slow = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const respond = async (body, hold) => {
      // A held response is released by its test, or after 15 seconds at most.
      if (hold)
        await Promise.race([
          hold,
          new Promise((done) => globalThis.setTimeout(done, 15000)),
        ]);
      return route
        .fulfill({
          status: 200,
          contentType: "application/json",
          headers: path === "/api/v1/courses/course-1" ? { ETag: '"v1"' } : {},
          body: JSON.stringify(body),
        })
        .catch(() => {});
    };
    const empty = { data: [], page: { hasMore: false, nextCursor: null } };
    if (path === "/api/v1/sessions/current")
      return respond({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Kevin Darby",
            email: "ta@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return respond({ data: { role: "ta" } });
    if (path === "/api/v1/courses/course-1")
      return respond({
        data: {
          id: "course-1",
          name: "CSE 214 Data Structures",
          status: "active",
        },
      });
    if (path.endsWith("/statistics/pulse"))
      return respond({ data: pulse }, slow.pulse);
    if (path.endsWith("/posts") && url.searchParams.get("duplicateStatus"))
      return respond({
        data: [
          {
            ...post("m1", "Old question"),
            duplicateStatus: "confirmed",
            duplicateOfPostId: "p1",
            canonicalTitle: "Red black trees",
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    if (path.endsWith("/posts"))
      return respond(
        {
          data: [
            post("p1", "Red black trees"),
            post("p2", "Height of a tree"),
            post("p3", "Inserting into b-trees"),
          ],
          page: { hasMore: false, nextCursor: null },
        },
        slow.posts,
      );
    if (path.endsWith("/unread-count")) return respond({ data: { count: 0 } });
    return respond(empty);
  });
}
const shot = (page, name, fullPage = true) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage });
const overflow = (page) =>
  page.locator("html").evaluate((html) => html.scrollWidth - html.clientWidth);
const tops = (page) =>
  page.evaluate(() =>
    [".pulse-tiles", ".pulse-heatmap", ".pulse-weeks"].map((selector) =>
      Math.round(
        globalThis.document.querySelector(selector).getBoundingClientRect().top,
      ),
    ),
  );

for (const [size, viewport] of [
  ["desktop", { width: 1536, height: 864 }],
  ["phone", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport });

    test("Course pulse holds its layout while loading, then shows exact values", async ({
      page,
    }) => {
      let release;
      await mockApi(page, {
        pulse: new Promise((done) => (release = done)),
      });
      await page.goto(`${origin}/courses/course-1/statistics`);
      // The first visit waits for the dev server to compile the app.
      await expect(page.getByRole("status")).toHaveText(
        "Loading course pulse…",
        { timeout: 30000 },
      );
      await expect(page.locator(".pulse-skeleton")).toHaveCSS("opacity", "1");
      // The real titles show at once; the frame is hidden from assistive
      // technology, which hears only the loading status.
      await expect(page.locator(".pulse-skeleton .pulse-tile h3")).toHaveText([
        "Busiest time",
        "Peak week",
        "First answer",
        "Unanswered",
      ]);
      await expect(
        page.getByRole("heading", { name: "Busiest time" }),
      ).toHaveCount(0);
      const skeleton = await tops(page);
      await shot(page, `${size}-pulse-skeleton`, false);
      release();

      await expect(page.locator(".pulse-tile-value").first()).toHaveText(
        "Tue 9 am–12 pm",
      );
      const loaded = await tops(page);
      for (const [index, top] of loaded.entries())
        expect(Math.abs(top - skeleton[index])).toBeLessThanOrEqual(2);
      await expect(page.getByLabel("Period")).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${size}-pulse`);

      const cell = page.getByLabel("Tuesday 10 am: 9 questions");
      await cell.focus();
      expect(
        await cell.evaluate(
          (element) => globalThis.getComputedStyle(element, "::after").content,
        ),
      ).toBe('"Tue 10 am · 9 questions"');
      await shot(page, `${size}-pulse-tooltip`, false);
    });
  });
}

test.describe("discussion", () => {
  test.use({ viewport: { width: 1536, height: 864 } });

  test("placeholder cards hold the feed, and staff review duplicates from the sidebar", async ({
    page,
  }) => {
    let release;
    await mockApi(page, {
      posts: new Promise((done) => (release = done)),
    });
    await page.goto(`${origin}/courses/course-1`);
    await expect(
      page.getByRole("status").filter({ hasText: "Loading posts…" }),
    ).toHaveCount(1);
    await expect(page.locator(".feed-skeleton li")).toHaveCount(6);
    await expect(page.locator(".feed-skeleton")).toHaveCSS("opacity", "1");
    const search = await page
      .getByRole("searchbox", { name: "Search posts" })
      .boundingBox();
    await shot(page, "desktop-feed-placeholders", false);
    release();

    await expect(
      page.getByRole("link", { name: /Red black trees/ }),
    ).toBeVisible();
    expect(
      (
        await page
          .getByRole("searchbox", { name: "Search posts" })
          .boundingBox()
      ).y,
    ).toBe(search.y);
    await expect(page.getByText("All caught up")).toBeVisible();

    const sidebar = page.getByRole("complementary", { name: "Post filters" });
    const duplicates = sidebar.getByRole("button", { name: /^Duplicates/ });
    await expect(duplicates).toHaveAttribute("aria-pressed", "false");
    await duplicates.click();
    await expect(duplicates).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Old question" }),
    ).toBeVisible();
    await shot(page, "desktop-duplicates-sidebar", false);

    await sidebar
      .getByRole("radio", { name: "All posts" })
      .click({ force: true });
    await expect(duplicates).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("link", { name: /Red black trees/ }),
    ).toBeVisible();
  });
});
