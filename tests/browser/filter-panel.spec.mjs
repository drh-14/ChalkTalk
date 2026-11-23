import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/discussion-layout");
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
    if (path.endsWith("/post-folders"))
      return route.fulfill({
        json: {
          data: Array.from({ length: 20 }, (_, index) => ({
            id: `folder-${index}`,
            name: `Week ${index + 1}`,
          })),
        },
      });
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
const shot = async (page, name) => {
  return page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });
};
const box = async (locator) => (await locator.boundingBox()) ?? {};

for (const viewport of [
  { width: 320, height: 780 },
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`bounded filters overlay ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let feeds = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.endsWith("/posts")) feeds++;
    });
    await mockApi(page, "ta");
    await page.addInitScript(() => {
      localStorage.setItem("chalktalk:filters:width", "9999");
      localStorage.setItem("chalktalk:filters:height", "9999");
    });
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    const feed = page.getByRole("region", { name: "Posts", exact: true });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await expect(page.getByText("Office hours", { exact: true })).toBeVisible();
    await shot(page, `overlay-${viewport.width}-closed`);
    const before = await box(feed);
    const requests = feeds;
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Post filters" });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((n) => n.contains(document.activeElement)))
      .toBe(true);
    const after = await box(feed);
    expect(after).toEqual(before);
    expect(feeds).toBe(requests);
    const search = await box(
      viewport.width <= 850
        ? page.getByRole("button", { name: "Search posts", exact: true })
        : page.getByRole("search"),
    );
    const newPost = await box(
      page.getByRole("button", { name: /^(?:Create post|New post)$/ }),
    );
    const t = await box(trigger);
    expect(t.x).toBeGreaterThanOrEqual(search.x + search.width);
    expect(Math.abs(t.y - search.y)).toBeLessThan(2);
    expect(Math.abs(t.y - newPost.y)).toBeLessThan(2);
    if (viewport.width > 850) {
      expect(t.x).toBeGreaterThanOrEqual(search.x + search.width);
      expect(newPost.x).toBeGreaterThanOrEqual(t.x + t.width);
    }
    if (viewport.width <= 850) {
      expect(newPost.x).toBeGreaterThanOrEqual(search.x + search.width);
      expect(t.x).toBeGreaterThanOrEqual(newPost.x + newPost.width);
    }
    const bounds = await box(dialog);
    expect(bounds.x).toBeGreaterThanOrEqual(15);
    expect(bounds.y).toBeGreaterThanOrEqual(15);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 15);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 15);
    await expect(
      page.getByRole("separator", { name: "Resize filters" }),
    ).toHaveCount(0);
    await shot(page, `overlay-${viewport.width}-open`);
    const show = dialog.getByRole("button", { name: /^Show/ });
    if ((await show.getAttribute("aria-expanded")) === "false")
      await show.click();
    await dialog.getByText("Notes", { exact: true }).click();
    await expect.poll(() => feeds).toBeGreaterThan(requests);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(
      dialog.getByRole("radio", { name: "Notes", exact: true }),
    ).toBeChecked();
    const folders = dialog.getByRole("button", { name: /^Folders/ });
    if ((await folders.getAttribute("aria-expanded")) === "false")
      await folders.click();
    const body = page.locator(".filter-overlay-body");
    expect(await body.evaluate((n) => n.scrollHeight > n.clientHeight)).toBe(
      true,
    );
    await body.evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    expect(await body.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
    const lowerFolder = dialog.getByRole("checkbox", { name: "Week 20" });
    await expect(lowerFolder).toBeInViewport();
    await lowerFolder.check();
    await expect(lowerFolder).toBeChecked();
    await expect(
      dialog.getByRole("button", { name: "Close filters" }),
    ).toBeInViewport();
    await shot(page, `overlay-${viewport.width}-scrolled`);
    if (viewport.width <= 850)
      await page
        .getByRole("button", { name: "Search posts", exact: true })
        .click();
    await page.getByRole("searchbox").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("searchbox")).toBeFocused();
    expect(
      await page.locator("html").evaluate((n) => n.scrollWidth - n.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
}

for (const width of [320, 390, 1280])
  test(`open filters stay bounded after page scroll ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await mockApi(page, "ta");
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    await page.evaluate(() => {
      document.body.style.minHeight = "300vh";
    });
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Post filters" });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(async () => (await box(trigger)).y).toBeLessThan(0);
    await page.screenshot({
      path: resolve(screenshots, `overlay-${width}-page-scrolled.png`),
    });
    const bounds = await box(dialog);
    expect(bounds.y).toBeGreaterThanOrEqual(15);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(765);
    await expect(
      dialog.getByRole("button", { name: "Close filters" }),
    ).toBeInViewport();
    const show = dialog.getByRole("button", { name: /^Show/ });
    if ((await show.getAttribute("aria-expanded")) === "false")
      await show.click();
    await dialog.getByText("Notes", { exact: true }).click();
    await expect(
      dialog.getByRole("radio", { name: "Notes", exact: true }),
    ).toBeChecked();
    const folders = dialog.getByRole("button", { name: /^Folders/ });
    if ((await folders.getAttribute("aria-expanded")) === "false")
      await folders.click();
    const body = dialog.locator(".filter-overlay-body");
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(
      dialog.getByRole("checkbox", { name: "Week 20" }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Close filters" }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

for (const width of [320, 390])
  test(`open filters stay bounded when visual viewport shrinks ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, "ta");
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    await page.locator(".discussion-toolbar").evaluate((node) => {
      node.style.marginTop = "220px";
    });
    const trigger = page.getByRole("button", { name: "Filters", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Post filters" });
    const folders = dialog.getByRole("button", { name: /^Folders/ });
    if ((await folders.getAttribute("aria-expanded")) === "false")
      await folders.click();
    await dialog.getByText("Manage folders").click();
    const name = dialog.getByRole("textbox", { name: "New folder name" });
    await name.focus();
    await expect(name).toBeFocused();
    const visualViewport = await page.evaluate(() => {
      const anchor = document.querySelector(".filter-overlay-trigger");
      const viewport = window.visualViewport;
      const offsetTop = 20;
      const height = Math.max(
        100,
        Math.floor(anchor.getBoundingClientRect().top - 40),
      );
      Object.defineProperties(viewport, {
        offsetTop: { configurable: true, value: offsetTop },
        height: { configurable: true, value: height },
      });
      viewport.dispatchEvent(new Event("resize"));
      return { offsetTop, height };
    });
    await expect
      .poll(async () => (await box(trigger)).y)
      .toBeGreaterThan(visualViewport.offsetTop + visualViewport.height);
    await page.screenshot({
      path: resolve(screenshots, `overlay-${width}-viewport-shrunk.png`),
    });
    const bounds = await box(dialog);
    expect(bounds.y).toBeGreaterThanOrEqual(visualViewport.offsetTop + 15);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(
      visualViewport.offsetTop + visualViewport.height - 15,
    );
    await expect(
      dialog.getByRole("button", { name: "Close filters" }),
    ).toBeInViewport();
    await expect(name).toBeFocused();
    const body = dialog.locator(".filter-overlay-body");
    await body.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    expect(await body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

for (const width of [320, 390])
  test(`mobile icon search expands below toolbar ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, "ta");
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    const toggle = page.getByRole("button", {
      name: "Search posts",
      exact: true,
    });
    const input = page.getByRole("searchbox", { name: "Search posts" });
    await expect(input).toBeHidden();
    await toggle.click();
    await expect(input).toBeFocused();
    const toolbar = await box(toggle);
    const field = await box(input);
    expect(field.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
    await input.fill("office hours");
    await shot(page, `mobile-${width}-search-expanded`);
    await input.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(input).toBeHidden();
    await toggle.click();
    await expect(input).toHaveValue("office hours");
    const clear = page.getByRole("button", { name: "Clear search" });
    await clear.focus();
    await expect(clear).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(input).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await expect(input).toHaveValue("office hours");
    await input.press("Escape");
    await page.keyboard.press("/");
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(input).toBeFocused();
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    const desktopClear = page.getByRole("button", { name: "Clear search" });
    await desktopClear.focus();
    await expect(desktopClear).toBeFocused();
    await page.setViewportSize({ width, height: 844 });
    await expect(desktopClear).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(desktopClear).toBeFocused();
    expect(
      await page.locator("html").evaluate((n) => n.scrollWidth - n.clientWidth),
    ).toBe(0);
  });

for (const width of [320, 390])
  test(`desktop search retains focus on mobile resize ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockApi(page, "ta");
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    const input = page.getByRole("searchbox", { name: "Search posts" });
    await input.focus();
    await page.setViewportSize({ width, height: 844 });
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.fill("office hours");
    await page.setViewportSize({ width: 1280, height: 900 });
    const clear = page.getByRole("button", { name: "Clear search" });
    await clear.focus();
    await page.setViewportSize({ width, height: 844 });
    await expect(clear).toBeVisible();
    await expect(clear).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(clear).toBeFocused();
  });

test("desktop plus opens existing composer", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, "ta");
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  const create = page.getByRole("button", { name: "New post", exact: true });
  await expect(create).toBeVisible();
  await expect(create).toHaveText("");
  const bounds = await box(create);
  expect(bounds.width).toBe(44);
  expect(bounds.height).toBe(44);
  await shot(page, "desktop-plus-toolbar");
  await create.click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toBeVisible();
  await shot(page, "desktop-plus-composer");
});
for (const width of [320, 390])
  test(`mobile search border and outside dismissal ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, "ta");
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    const toggle = page.getByRole("button", {
      name: "Search posts",
      exact: true,
    });
    const input = page.getByRole("searchbox", { name: "Search posts" });
    const border = () =>
      toggle.evaluate((n) => ({
        color: getComputedStyle(n).borderTopColor,
        width: getComputedStyle(n).borderTopWidth,
      }));
    const closed = await border();
    await toggle.click();
    await expect(input).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await border()).toEqual({ color: "rgb(36, 81, 63)", width: "1px" });
    await shot(page, `mobile-${width}-search-open-empty`);
    await input.fill("office hours");
    await input.click();
    await expect(input).toBeVisible();
    await shot(page, `mobile-${width}-search-open-populated`);
    // A real focusable control outside the search region must retain pointer focus.
    const outside = page.getByRole("button", { name: "Filters", exact: true });
    const outsideBounds = await box(outside);
    await page.mouse.move(
      outsideBounds.x + outsideBounds.width / 2,
      outsideBounds.y + outsideBounds.height / 2,
    );
    await page.mouse.down();
    await expect(outside).toBeFocused();
    await expect(input).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(await border()).toEqual(closed);
    await shot(page, `mobile-${width}-search-dismissed-populated`);
    await page.mouse.up();
    // Filters legitimately moves focus into its overlay; use its close then another outside control for focus continuity.
    await page.keyboard.press("Escape");
    await expect(outside).toBeFocused();
    await toggle.click();
    await expect(input).toHaveValue("office hours");
    await expect(input).toBeFocused();
    expect(await border()).toEqual({ color: "rgb(36, 81, 63)", width: "1px" });
    await shot(page, `mobile-${width}-search-reopened`);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(input).toHaveValue("");
    await expect(input).toBeVisible();
    expect(await border()).toEqual({ color: "rgb(36, 81, 63)", width: "1px" });
    await shot(page, `mobile-${width}-search-cleared-open`);
    await input.fill("retained");
    await toggle.click();
    await expect(input).toBeHidden();
    await expect(toggle).toBeFocused();
    expect(await border()).toEqual(closed);
    await toggle.click();
    await input.press("Escape");
    await expect(toggle).toBeFocused();
    expect(await border()).toEqual(closed);
  });
