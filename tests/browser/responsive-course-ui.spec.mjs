import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const evidence = resolve(
  root,
  "test-results/browser-screenshots/responsive-course-ui",
);
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
test.afterAll(async () => await vite?.close());

const courseName =
  "Advanced Topics in Computational Physics and Scientific Computing";
const post = {
  id: "p1",
  courseId: "course-1",
  type: "note",
  deleted: false,
  title: "Wide content",
  bodyMarkdown: [
    "Inline $\\underbrace{a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}}_{\\text{a deliberately wide expression}}$ remains readable.",
    "",
    "$$",
    "\\underbrace{a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}}_{\\text{a deliberately wide expression}}",
    "$$",
    "",
    "| | Excellent | Good | Meet Expectation | Need Improvement | Missing Work |",
    "| --- | --- | --- | --- | --- | --- |",
    "| Instructor | 7 | 6 | 1 | 0 | 0 |",
  ].join("\n"),
  author: {
    userId: "u2",
    displayName: "Ada",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  createdAt: "2026-10-22T00:00:00Z",
  lastActivityAt: "2026-10-22T00:00:00Z",
  version: 1,
};
async function mockApi(page, fixturePost = post) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/v1/sessions/current"
        ? {
            id: "auth",
            user: { id: "u1", displayName: "Maya", email: "maya@example.edu" },
            csrfToken: "csrf",
            expiresAt: "2090-01-01T00:00:00Z",
          }
        : path === "/api/v1/courses/course-1"
          ? { id: "course-1", name: courseName, status: "active" }
          : path === "/api/v1/courses/course-1/members/u1"
            ? { role: "instructor" }
            : path === "/api/v1/posts/p1"
              ? fixturePost
              : path.endsWith("/posts")
                ? [fixturePost]
                : path.endsWith("/statistics/pulse")
                  ? {
                      courseId: "course-1",
                      timeZone: "UTC",
                      firstQuestionAt: null,
                      lastQuestionAt: null,
                      questions: 1,
                      answered: 0,
                      unanswered: 1,
                      medianFirstAnswerMinutes: null,
                      hours: Array.from({ length: 7 }, () => Array(24).fill(0)),
                      weeks: [{ weekStart: "2026-10-19", questions: 1 }],
                      topics: [],
                      helpers: [],
                      generatedAt: "2026-10-21T12:00:00Z",
                    }
                  : [];
    await route.fulfill({
      json: { data, page: { nextCursor: null, hasMore: false } },
    });
  });
}
const overflow = (page) =>
  page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth);

for (const width of [320, 390]) {
  test(`mobile ${width}: compact usable header and touch targets`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page);
    await page.goto(`${origin}/courses/course-1/statistics`);
    const header = page.locator(".app-bar.course");
    await expect(header).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Course navigation" }),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const headerHeight = (await header.boundingBox()).height;
    expect(headerHeight).toBeLessThanOrEqual(width === 320 ? 205 : 180);
    const tabs = page.locator(".course-tabs a");
    for (let i = 0; i < (await tabs.count()); i++)
      expect((await tabs.nth(i).boundingBox()).height).toBeGreaterThanOrEqual(
        44,
      );
    if (width === 320) {
      const switcher = page.getByRole("button", { name: "Switch course" });
      for (
        let i = 0;
        i < 12 &&
        !(await switcher.evaluate(
          (node) => node === globalThis.document.activeElement,
        ));
        i++
      )
        await page.keyboard.press("Tab");
      await expect(switcher).toBeFocused();
      await expect(switcher).toHaveCSS("outline-style", "solid");
      await expect(page.locator(".app-bar-course")).toHaveCSS(
        "overflow",
        "visible",
      );
    }
    await page.screenshot({
      path: resolve(evidence, `header-${width}.png`),
      fullPage: true,
    });
  });
}

test("mobile wide math and table remain inside page with scroll cue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  const detail = page.getByRole("region", { name: "Post detail" });
  await expect(detail.locator(".katex-display")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const math = detail.locator(".katex-display");
  expect(await math.evaluate((node) => node.scrollWidth)).toBeGreaterThan(
    await math.evaluate((node) => node.clientWidth),
  );
  const inlineMath = detail.locator("p > .katex").first();
  await expect(inlineMath).toBeVisible();
  expect(await inlineMath.evaluate((node) => node.scrollWidth)).toBeGreaterThan(
    await inlineMath.evaluate((node) => node.clientWidth),
  );
  await inlineMath.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  expect(await inlineMath.evaluate((node) => node.scrollLeft)).toBeGreaterThan(
    0,
  );
  const table = detail.getByRole("region", { name: "Scrollable table" });
  await expect(table).toBeVisible();
  await expect(detail.getByText(/scroll table horizontally/i)).toBeVisible();
  await table.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => table.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await page.screenshot({
    path: resolve(evidence, "mobile-wide-content.png"),
    fullPage: true,
  });
});

test("table card preview stays inline without a scroll cue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, {
    ...post,
    bodyMarkdown: [
      "| Item | Excellent | Good |",
      "| --- | --- | --- |",
      "| Instructor | 7 | 6 |",
    ].join("\n"),
  });
  await page.goto(`${origin}/courses/course-1`);
  const preview = page.locator(".post-card-preview").first();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Excellent");
  await expect(preview.locator(".table-wrap")).toHaveCSS("display", "inline");
  await expect(preview.locator(".table-scroll")).toHaveCSS("display", "inline");
  await expect(preview.locator(".table-scroll-hint")).toBeHidden();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: resolve(evidence, "mobile-table-preview.png"),
    fullPage: true,
  });
});

test("mobile statistics toggle has a 44px target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1/statistics`);
  const toggle = page.getByRole("button", { name: "Show as tables" });
  await expect(toggle).toBeVisible();
  expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Show as charts" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "mobile-statistics.png"),
    fullPage: true,
  });
});

test("desktop course title uses available space and reveals full name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  const title = page.locator(".app-bar-course h1");
  await expect(title).toHaveText(courseName);
  await expect(title).toHaveAttribute("title", courseName);
  await expect(
    page.getByRole("button", { name: "Switch course" }),
  ).toHaveAttribute("title", courseName);
  expect((await title.boundingBox()).width).toBeGreaterThan(256);
  const switcher = page.getByRole("button", { name: "Switch course" });
  for (
    let i = 0;
    i < 12 &&
    !(await switcher.evaluate(
      (node) => node === globalThis.document.activeElement,
    ));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(switcher).toBeFocused();
  await expect(page.locator(".course-title-tooltip")).toBeVisible();
  await expect(page.locator(".course-title-tooltip")).toHaveText(courseName);
  await page.screenshot({
    path: resolve(evidence, "desktop-title.png"),
    fullPage: true,
  });
});
