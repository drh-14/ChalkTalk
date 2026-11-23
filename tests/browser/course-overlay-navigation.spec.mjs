import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/course-overlay-navigation");
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

async function mockApp(page, role = "instructor") {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path.includes("/resources/nested"))
      return route.fulfill({
        status: 404,
        json: { error: { code: "not_found", message: "Resource not found" } },
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
      return reply({ data: { role } });
    if (path === "/api/v1/courses/course-1/post-draft")
      return route.fulfill({
        headers: { ETag: '"v1"' },
        json: {
          data: {
            courseId: "course-1",
            content: null,
            updatedAt: null,
            version: 1,
          },
        },
      });
    if (path === "/api/v1/posts/p1") return reply({ data: posts[0] });
    if (path === "/api/v1/courses/course-1/posts")
      return reply({
        data: posts,
        page: { nextCursor: null, hasMore: false },
      });
    if (path === "/api/v1/courses/course-1/threads/unread-count")
      return reply({ data: { count: 3 } });
    return reply({ data: [], page: { nextCursor: null, hasMore: false } });
  });
}

for (const width of [320, 390, 1280])
  test(`course header navigation ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.goto(`${origin}/courses/course-1`);
    await page
      .getByRole("heading", { name: "CSE 214-01 Data Structures" })
      .waitFor();
    await expect(
      page.getByRole("link", { name: "All courses", exact: true }),
    ).toHaveCount(0);
    const logo = await page
      .getByRole("link", { name: "ChalkTalk", exact: true })
      .boundingBox();
    const title = await page
      .getByRole("heading", { name: "CSE 214-01 Data Structures" })
      .boundingBox();
    if (width <= 850) {
      expect(title.y).toBeGreaterThan(logo.y);
      const focusOrder = [
        page.getByRole("button", { name: /^Notifications/ }),
        page.getByRole("button", { name: "Account menu for Maya Chen" }),
        page.getByRole("button", { name: "Switch course" }),
        page.getByRole("button", { name: "Current section: Discussion" }),
      ];
      await page.getByRole("link", { name: "ChalkTalk" }).focus();
      for (const control of focusOrder) {
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
      }
      const trigger = page.getByRole("button", {
        name: "Current section: Discussion",
      });
      await trigger.click();
      await expect(
        page
          .getByRole("navigation", { name: "Course navigation" })
          .getByRole("link"),
      ).toHaveCount(6);
      await page.screenshot({
        path: resolve(screenshots, `header-${width}-navigation.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page
        .getByRole("link", { name: "Course resources", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Current section: Course resources" }),
      ).toBeVisible();
    } else {
      expect(Math.abs(title.y - logo.y)).toBeLessThan(15);
      await expect(
        page.getByRole("heading", { name: "CSE 214-01 Data Structures" }),
      ).toBeFocused();
      await expect(
        page.getByRole("region", { name: "Posts", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".course-navigation")).not.toHaveClass(
        /pending/,
      );
      await expect(
        page.getByRole("link", { name: "Discussion", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "ChalkTalk" }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Switch course" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Switch course" }).press("Tab");
      await expect(
        page.getByRole("link", { name: "Discussion", exact: true }),
      ).toBeFocused();
    }
    expect(
      await page.locator("html").evaluate((n) => n.scrollWidth - n.clientWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: resolve(screenshots, `header-${width}-closed.png`),
      fullPage: true,
    });
  });

for (const role of ["student", "ta", "instructor"])
  test(`mobile navigation preserves ${role} links and nested route`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await mockApp(page, role);
    await page.goto(`${origin}/courses/course-1/resources/nested/view`);
    // Use the existing router's resource detail path and the same navigation data.
    const trigger = page.getByRole("button", {
      name: "Current section: Course resources",
    });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const links = page
      .getByRole("navigation", { name: "Course navigation" })
      .getByRole("link");
    await expect(links).toHaveCount(6);
    await expect(page.getByLabel("3 unread Thread messages")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Course resources", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.screenshot({
      path: resolve(screenshots, `navigation-${role}.png`),
      fullPage: true,
    });
    await page.mouse.click(10, 110);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
test("mobile dropdown retains declined edits and follows only accepted navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  await page.getByRole("button", { name: "Edit post", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Post title" });
  await title.fill("Unsaved course rules");
  const trigger = page.getByRole("button", {
    name: "Current section: Discussion",
  });
  await trigger.click();
  await page
    .getByRole("link", { name: "Course resources", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Confirm action" });
  await expect(confirmation).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "navigation-draft-guard.png"),
    fullPage: true,
  });
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(title).toHaveValue("Unsaved course rules");
  expect(new URL(page.url()).pathname).toBe("/courses/course-1/posts/p1");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page
    .getByRole("link", { name: "Course resources", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Current section: Course resources" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "navigation-draft-accepted.png"),
    fullPage: true,
  });
});

test("folder confirmation keeps filters and focus visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.route("**/api/v1/courses/course-1/post-folders", (route) =>
    route.fulfill({ json: { data: [{ id: "folder-1", name: "Week 1" }] } }),
  );
  await page.goto(`${origin}/courses/course-1`);
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  const overlay = page.getByRole("dialog", { name: "Post filters" });
  const folders = overlay.getByRole("button", { name: /^Folders/ });
  if ((await folders.getAttribute("aria-expanded")) === "false")
    await folders.click();
  await overlay.getByText("Manage folders").click();
  const remove = overlay.getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const confirmation = page.getByRole("dialog", { name: "Delete folder" });
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(overlay).toBeVisible();
  await expect(remove).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "folder-confirm-cancel-focus.png"),
    fullPage: true,
  });
  await remove.click();
  await expect(confirmation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(overlay).toBeVisible();
  await expect(remove).toBeFocused();
  await page.getByRole("button", { name: "Search posts", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search posts" }).click();
  await expect(overlay).toBeHidden();
});

test("mobile filters close on post history navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto(`${origin}/courses/course-1`);
  await page.getByRole("link", { name: /Course rules/ }).click();
  await expect(page).toHaveURL(/\/courses\/course-1\/posts\/p1$/);
  await page.goBack();
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.goForward();
  await expect(page).toHaveURL(/\/courses\/course-1\/posts\/p1$/);
  await expect(page.getByRole("dialog", { name: "Post filters" })).toBeHidden();
  await expect(trigger).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goBack();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("keyboard selection closes filters when its feed trigger disappears", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto(`${origin}/courses/course-1`);
  const trigger = page.getByRole("button", { name: "Filters", exact: true });
  await trigger.click();
  await page.getByRole("link", { name: /Course rules/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/courses\/course-1\/posts\/p1$/);
  await expect(page.getByRole("dialog", { name: "Post filters" })).toBeHidden();
  await expect(trigger).toHaveCount(0);
  await page.goBack();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page
    .getByRole("button", { name: /^(?:Create post|New post)$/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Post filters" })).toBeHidden();
  await expect(trigger).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "keyboard-new-post-selection.png"),
    fullPage: true,
  });
});

for (const width of [851, 1024, 1280, 1600])
  test(`desktop full section links stay on the logo row ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.goto(`${origin}/courses/course-1`);
    await expect(
      page.getByRole("heading", { name: "CSE 214-01 Data Structures" }),
    ).toBeVisible();
    const logo = await page
      .getByRole("link", { name: "ChalkTalk", exact: true })
      .boundingBox();
    await expect(
      page.getByRole("link", { name: "All courses", exact: true }),
    ).toHaveCount(0);
    const links = page
      .getByRole("navigation", { name: "Course navigation" })
      .getByRole("link");
    await expect(links).toHaveCount(6);
    await expect(
      page.getByRole("button", { name: /Current section/ }),
    ).toBeHidden();
    for (const link of await links.all()) {
      await expect(link).toBeVisible();
      const b = await link.boundingBox();
      expect(
        Math.abs(b.y + b.height / 2 - logo.y - logo.height / 2),
      ).toBeLessThan(12);
    }

    expect((await page.getByRole("banner").boundingBox()).height).toBeLessThan(
      62,
    );
    expect(
      await page.locator("html").evaluate((n) => n.scrollWidth - n.clientWidth),
    ).toBe(0);
    await page.screenshot({
      path: resolve(screenshots, `desktop-inline-full-${width}.png`),
      fullPage: true,
    });
  });

for (const width of [320, 1280])
  test(`logo is the guarded home link ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.goto(`${origin}/courses/course-1/posts/p1`);
    await page.getByRole("button", { name: "Edit post", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Post title" });
    await title.fill("Unsaved logo navigation");
    const logo = page.getByRole("link", { name: "ChalkTalk", exact: true });
    await expect(logo).toHaveAttribute("href", "/home");
    await expect(
      page.getByRole("link", { name: "All courses", exact: true }),
    ).toHaveCount(0);
    await logo.click();
    const dialog = page.getByRole("dialog", { name: "Confirm action" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(title).toHaveValue("Unsaved logo navigation");
    expect(new URL(page.url()).pathname).toBe("/courses/course-1/posts/p1");
    await logo.click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page).toHaveURL(/\/home$/);
    await page.screenshot({
      path: resolve(screenshots, `logo-home-${width}.png`),
      fullPage: true,
    });
  });

for (const width of [320, 390, 1280]) {
  test(`full App final toolbar and overlay evidence ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.route("**/courses/course-1/post-folders", (route) =>
      route.fulfill({
        json: {
          data: Array.from({ length: 30 }, (_, i) => ({
            id: `01a0e5cc-58ae-7009-9f43-${String(i + 1).padStart(12, "0")}`,
            courseId: "course-1",
            name: `Week ${i + 1}`,
            position: i,
            version: 1,
          })),
          page: { hasMore: false, nextCursor: null },
        },
      }),
    );
    await page.goto(`${origin}/courses/course-1`);
    await expect(
      page.getByRole("heading", { name: "CSE 214-01 Data Structures" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Note Course rules/ }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const shot = (state) =>
      page.screenshot({
        path: resolve(screenshots, `full-ui-${width}-${state}.png`),
        fullPage: true,
      });
    await shot("toolbar-closed");
    const filters = page.getByRole("button", { name: "Filters", exact: true });
    if (width <= 850) {
      const toggle = page.getByRole("button", {
        name: "Search posts",
        exact: true,
      });
      const input = page.getByRole("searchbox", { name: "Search posts" });
      await toggle.click();
      await expect(input).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toHaveCSS("border-top-color", "rgb(36, 81, 63)");
      await shot("search-open-empty");
      await input.fill("trees");
      await shot("search-open-populated");
      const outside = page.getByRole("button", {
        name: "Account menu for Maya Chen",
      });
      const box = await outside.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await expect(input).toBeHidden();
      await expect(outside).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
      await shot("search-dismissed-populated");
      await page.mouse.up();
      await page.keyboard.press("Escape");
      await toggle.click();
      await expect(input).toHaveValue("trees");
      await expect(input).toBeFocused();
      await expect(toggle).toHaveCSS("border-top-color", "rgb(36, 81, 63)");
      await shot("search-reopened");
      await page.getByRole("button", { name: "Clear search" }).click();
      await expect(input).toHaveValue("");
      await expect(input).toBeVisible();
      await shot("search-cleared-open");
      await input.press("Escape");
      await expect(toggle).toBeFocused();
    }
    const feed = page.getByRole("region", { name: "Posts", exact: true });
    const before = await feed.boundingBox();
    await filters.click();
    const overlay = page.getByRole("dialog", { name: "Post filters" });
    await expect(overlay).toBeVisible();
    expect(await feed.boundingBox()).toEqual(before);
    await shot("filters-open");
    const folders = overlay.getByRole("button", { name: /Folders/i });
    if ((await folders.getAttribute("aria-expanded")) === "false")
      await folders.click();
    const last = overlay.getByRole("checkbox", {
      name: "Week 30",
      exact: true,
    });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();
    await last.check();
    await expect(last).toBeChecked();
    await shot("filters-scrolled");
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    await expect(filters).toBeFocused();
    if (width === 1280) {
      await page.getByRole("button", { name: "New post", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toBeVisible();
      await shot("plus-composer");
    }
  });
}
