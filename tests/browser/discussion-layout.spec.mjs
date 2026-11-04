import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/discussion-layout");
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

const author = {
  userId: "ta-1",
  displayName: "Zeyu Yang",
  anonymous: false,
  deleted: false,
};
const selected = {
  id: "p1",
  courseId: "course-1",
  type: "question",
  deleted: false,
  title: "Milestone 2 presentation order and the rubric for the final demo day",
  bodyMarkdown:
    "First paragraph about the presentation order for Monday.\n\nSecond paragraph that explains the rubric, the time limit, and what to bring to the final demo so everyone is ready.",
  author,
  anonymous: false,
  tags: ["project", "logistics"],
  answered: false,
  pinned: true,
  unread: false,
  createdAt: "2026-10-22T00:00:00Z",
  lastActivityAt: "2026-10-22T00:00:00Z",
  version: 2,
};
const unread = {
  ...selected,
  id: "p2",
  type: "note",
  title: "Office hours",
  bodyMarkdown: "Room 332.",
  tags: ["other"],
  pinned: false,
  unread: true,
};

async function mockApi(page, role) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/members/u1"))
      return route.fulfill({ json: { data: { role } } });
    if (path === "/api/v1/posts/p1")
      return route.fulfill({ json: { data: selected } });
    if (path.endsWith("/posts"))
      return route.fulfill({
        json: {
          data: [selected, unread],
          page: { nextCursor: null, hasMore: false },
        },
      });
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({ json: { data: [] } });
  });
}
const shot = (page, name) =>
  page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });
const box = async (locator) => (await locator.boundingBox()) ?? {};

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport, ignoreHTTPSErrors: true });

    test("staff see one post action toolbar before the body", async ({
      page,
    }) => {
      await mockApi(page, "ta");
      await page.goto(`${origin}/attachments-fixture.html`);
      const detail = page.getByRole("region", { name: "Post detail" });
      const toolbar = detail.getByRole("group", { name: "Post actions" });
      await expect(toolbar.getByRole("button")).toHaveText([
        "Follow",
        "Edit post",
        "Unpin",
        "Lock discussion",
        "Merge as duplicate",
        "Delete post",
      ]);
      const heights = await toolbar
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => Math.round(button.offsetHeight)),
        );
      expect(new Set(heights).size).toBe(1);
      const body = await box(detail.locator(".post-markdown").first());
      expect((await box(toolbar)).y).toBeLessThan(body.y);
      const pageOverflow = await page
        .locator("html")
        .evaluate((html) => html.scrollWidth - html.clientWidth);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      await shot(page, `${size}-staff-toolbar`);
    });

    test("a student sees only Follow", async ({ page }) => {
      await mockApi(page, "student");
      await page.goto(`${origin}/attachments-fixture.html`);
      const toolbar = page
        .getByRole("region", { name: "Post detail" })
        .getByRole("group", { name: "Post actions" });
      await expect(toolbar.getByRole("button")).toHaveText(["Follow"]);
      await shot(page, `${size}-student-toolbar`);
    });

    if (size === "desktop")
      test("cards align tags with titles and clamp long text", async ({
        page,
      }) => {
        await mockApi(page, "ta");
        await page.goto(`${origin}/attachments-fixture.html`);
        const listings = page.getByRole("region", { name: "Post listings" });
        const card = listings.locator(".post-list > li").first();
        await expect(card).toBeVisible();
        const badge = await box(card.locator(".post-type-badge"));
        const titleText = await box(card.locator(".post-card-title strong"));
        // The badge shares the title's first line.
        expect(Math.abs(badge.y - titleText.y)).toBeLessThan(12);
        const titleLeft = (await box(card.locator(".post-card-title"))).x;
        const tagLeft = (await box(card.locator(".tag-chip").first())).x;
        expect(Math.abs(tagLeft - titleLeft)).toBeLessThanOrEqual(1);
        for (const selector of [".post-card-title", ".post-card-preview"]) {
          const clamp = await card.locator(selector).evaluate((element) => ({
            lines:
              element.ownerDocument.defaultView.getComputedStyle(element)
                .webkitLineClamp,
            cut: element.scrollHeight > element.clientHeight,
          }));
          expect(clamp).toEqual({ lines: "2", cut: true });
        }
        // The unread summary sits in the status row above the list.
        await expect(
          listings.getByRole("button", { name: "Mark all read" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Mark all read" }),
        ).toBeVisible();
        await shot(page, `${size}-feed-cards`);
      });
  });
}
