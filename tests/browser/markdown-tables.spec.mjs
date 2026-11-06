import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/markdown-tables");
let vite;
let origin;
test.beforeAll(async () => {
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

// The body an import of Piazza's M3 grade distribution produces.
const post = {
  id: "p1",
  courseId: "course-1",
  type: "note",
  deleted: false,
  title: "M3 grade distribution",
  bodyMarkdown: [
    "|  | Excellent | Good | Meet Expectation | Need Improvement | Missing Work |",
    "| --- | --- | --- | --- | --- | --- |",
    "| Instructor | 7 | 6 | 1 | 0 | 0 |",
    "| TA | 4 | 7 | 3 | 0 | 0 |",
    "",
    "Hello everyone: Here is the milestone grade distribution. ~~proposal quality~~ work quality, see https://example.edu/rubric",
  ].join("\n"),
  author: {
    userId: "ta-1",
    displayName: "Zeyu Yang",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: ["exam", "project"],
  createdAt: "2026-10-22T00:00:00Z",
  lastActivityAt: "2026-10-22T00:00:00Z",
  version: 1,
};

async function mockApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/members/u1"))
      return route.fulfill({ json: { data: { role: "student" } } });
    if (path === "/api/v1/posts/p1")
      return route.fulfill({ json: { data: post } });
    if (path.endsWith("/posts"))
      return route.fulfill({
        json: { data: [post], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({ json: { data: [] } });
  });
}

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport, ignoreHTTPSErrors: true });
    test("an imported grade table renders as a table", async ({ page }) => {
      await mockApi(page);
      await page.goto(`${origin}/attachments-fixture.html`);
      const detail = page.getByRole("region", { name: "Post detail" });
      const table = detail.getByRole("table");
      await expect(table).toBeVisible();
      await expect(table.getByRole("columnheader")).toHaveText([
        "",
        "Excellent",
        "Good",
        "Meet Expectation",
        "Need Improvement",
        "Missing Work",
      ]);
      await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
        "Instructor",
        "7",
        "6",
        "1",
        "0",
        "0",
      ]);
      await expect(detail.getByText("proposal quality")).toHaveCSS(
        "text-decoration-line",
        "line-through",
      );
      await expect(
        detail.getByRole("link", { name: "https://example.edu/rubric" }),
      ).toHaveAttribute("href", "https://example.edu/rubric");
      if (size === "desktop") {
        // The card preview reads the table as running text on one line.
        await expect(
          page.locator(".post-card-preview").first().getByRole("table"),
        ).toHaveCSS("display", "inline");
      } else {
        const scroller = detail.locator(".table-scroll");
        const widths = await scroller.evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }));
        expect(widths.scroll).toBeGreaterThan(widths.client);
        const pageOverflow = await page
          .locator("html")
          .evaluate((html) => html.scrollWidth - html.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(0);
      }
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(screenshots, `${size}-table.png`),
        fullPage: true,
      });
    });
  });
}
