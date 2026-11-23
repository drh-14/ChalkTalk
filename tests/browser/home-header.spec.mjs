import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/home-header");
let vite;
let origin;

test.beforeAll(async () => {
  mkdirSync(screenshots, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => await vite?.close());

async function mockHome(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = {
      "/api/v1/sessions/current": {
        id: "session-1",
        user: { id: "u1", displayName: "Maya Chen", email: "maya@example.edu" },
        csrfToken: "csrf",
        expiresAt: "2090-01-01T00:00:00Z",
      },
      "/api/v1/users/me": {
        id: "u1",
        displayName: "Maya Chen",
        email: "maya@example.edu",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        version: 1,
      },
      "/api/v1/courses": [
        {
          id: "course-1",
          name: "Introduction to Computer Science",
          status: "active",
        },
        { id: "course-2", name: "Linear Algebra", status: "active" },
      ],
      "/api/v1/users/me/collaboration-sessions": [],
      "/api/v1/users/me/notifications/unread-count": { count: 1 },
      "/api/v1/users/me/notifications": [
        {
          id: "n1",
          kind: "answer_created",
          courseId: "course-1",
          courseName: "Introduction to Computer Science",
          postId: "post-1",
          postTitle: "How does recursion stop?",
          actor: { displayName: "Grace" },
          preview: "Add a base case.",
          responseUnavailable: false,
          addressedToOwner: true,
          destination: {
            kind: "answer",
            postId: "post-1",
            responseId: "answer-1",
          },
          createdAt: new Date().toISOString(),
          readAt: null,
        },
      ],
    }[path];
    if (data === undefined)
      return route.fulfill({
        status: 404,
        json: { error: { message: "Unexpected mock request" } },
      });
    return route.fulfill({
      headers: path === "/api/v1/users/me" ? { ETag: '"v1"' } : {},
      json: { data, page: { nextCursor: null } },
    });
  });
}

async function expectInsideViewport(locator, width) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}
async function expectNoOverflow(page) {
  expect(
    await page
      .locator("html")
      .evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(0);
}

for (const width of [1440, 390, 320]) {
  test(`home ${width}: full-width header and accessible controls preserve content layout`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockHome(page);
    await page.goto(`${origin}/home`);
    await expect(
      page.getByRole("heading", { name: "Your courses", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const banner = page.getByRole("banner");
    const logo = banner.getByRole("link", { name: "ChalkTalk" });
    const bell = banner.getByRole("button", {
      name: "Notifications, 1 unread",
    });
    const profile = banner.getByRole("button", {
      name: "Account menu for Maya Chen",
    });
    await expect(bell).toBeVisible();
    await expect(profile).toBeVisible();
    const logoBox = await logo.boundingBox();
    const profileBox = await profile.boundingBox();
    expect(logoBox.x).toBeCloseTo(20, 0);
    expect(profileBox.x + profileBox.width).toBeCloseTo(width - 20, 0);
    expect((await banner.boundingBox()).height).toBeCloseTo(52, 0);
    const mainBox = await page.getByRole("main").boundingBox();
    expect(mainBox.width).toBeCloseTo(Math.min(width, 1024), 0);
    expect(mainBox.x).toBeCloseTo(Math.max(0, (width - 1024) / 2), 0);
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `home-${width}.png`),
      fullPage: true,
    });

    // The existing logo, notifications and profile retain their keyboard order.
    await logo.focus();
    await expect(logo).toBeFocused();
    await expect(logo).toHaveAttribute("href", "/home");
    await page.keyboard.press("Tab");
    await expect(bell).toBeFocused();
    await expect(bell).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    const notifications = page.getByRole("region", { name: "Notifications" });
    await page.screenshot({
      path: resolve(screenshots, `notifications-${width}.png`),
      fullPage: true,
    });
    await expectInsideViewport(notifications, width);
    const panelBox = await notifications.boundingBox();
    const bellBox = await bell.boundingBox();
    expect(panelBox.x + panelBox.width).toBeCloseTo(
      bellBox.x + bellBox.width,
      0,
    );
    expect(panelBox.y).toBeCloseTo(bellBox.y + bellBox.height + 8, 0);
    if (width < 1440) expect(panelBox.x).toBeCloseTo(20, 0);
    else expect(panelBox.width).toBeCloseTo(384, 0);
    await expect(notifications.getByText("Add a base case.")).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `notifications-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(notifications).toHaveCount(0);
    await expect(bell).toBeFocused();
    await expect(bell).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Tab");
    await expect(profile).toBeFocused();
    await expect(profile).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    const settings = banner.getByRole("link", { name: "Account settings" });
    await expect(settings).toHaveAttribute("href", "/account");
    await expectInsideViewport(page.locator(".account-panel"), width);
    await expect(profile).toHaveAttribute("aria-expanded", "true");
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `profile-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(profile).toBeFocused();
    await expect(profile).toHaveAttribute("aria-expanded", "false");
    await logo.click();
    await expect(page).toHaveURL(`${origin}/home`);
  });
}

for (const width of [1440, 390, 320]) {
  test(`home ${width}: course actions share one row and open their labeled forms`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockHome(page);
    await page.goto(`${origin}/home`);
    await expect(
      page.getByRole("heading", { name: "Your courses", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const actions = page.locator(".course-actions");
    const create = actions.getByRole("button", {
      name: "Create course",
      exact: true,
    });
    const join = actions.getByRole("button", {
      name: "Join a course",
      exact: true,
    });
    const createBox = await create.boundingBox();
    const joinBox = await join.boundingBox();
    expect(createBox.y).toBeCloseTo(joinBox.y, 0);
    expect(createBox.x).toBeLessThan(joinBox.x);
    expect(joinBox.x - createBox.x - createBox.width).toBeCloseTo(12, 0);
    for (const button of [create, join]) {
      await expectInsideViewport(button, width);
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(40);
      await expect(button).toHaveCSS("font-size", "15.2px");
      await expect(button).toHaveCSS("padding-left", "16px");
      await expect(button).toHaveCSS("padding-right", "16px");
    }
    if (width === 320) {
      expect(createBox.height).toBeGreaterThan(40);
      expect(joinBox.height).toBeGreaterThan(40);
    } else {
      expect(createBox.height).toBeCloseTo(40, 0);
      expect(joinBox.height).toBeCloseTo(40, 0);
    }
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `actions-${width}.png`),
      fullPage: true,
    });

    await create.focus();
    await expect(create).toBeFocused();
    await expect(create).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Create a course", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Course name", exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `create-form-${width}.png`),
      fullPage: true,
    });

    // Switching forms keeps the original action order and keyboard access.
    await expect(create).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(join).toBeFocused();
    await expect(join).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Join a course", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Course name", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Course link ID", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Join code", exact: true }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({
      path: resolve(screenshots, `join-form-${width}.png`),
      fullPage: true,
    });
  });
}

test("account settings retain their existing narrow header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await mockHome(page);
  await page.goto(`${origin}/account`);
  await expect(page.getByRole("textbox", { name: "Display name" })).toHaveValue(
    "Maya Chen",
  );
  const logo = page
    .getByRole("banner")
    .getByRole("link", { name: "ChalkTalk" });
  await expect(logo).toBeVisible();
  expect((await logo.boundingBox()).x).toBeCloseTo(228, 0);
  await page.screenshot({
    path: resolve(screenshots, "account-header-1440.png"),
    fullPage: true,
  });
});
