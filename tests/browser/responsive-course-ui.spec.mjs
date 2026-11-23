import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const evidence =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/responsive-course-ui");
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
const longCourseName = `${courseName} and Applied Mathematics`;
const mobileCourseName = `${longCourseName} ${"Extraordinary".repeat(20)}`;
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
async function mockApi(
  page,
  fixturePost = post,
  fixtureCourseName = courseName,
  role = "instructor",
) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    const data =
      path === "/api/v1/sessions/current"
        ? {
            id: "auth",
            user: { id: "u1", displayName: "Maya", email: "maya@example.edu" },
            csrfToken: "csrf",
            expiresAt: "2090-01-01T00:00:00Z",
          }
        : path === "/api/v1/courses/course-1"
          ? { id: "course-1", name: fixtureCourseName, status: "active" }
          : path === "/api/v1/courses/course-1/members/u1"
            ? { role }
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
    await mockApi(page, post, mobileCourseName);
    await page.goto(`${origin}/courses/course-1/statistics`);
    const header = page.locator(".app-bar.course");
    await expect(header).toBeVisible();
    const section = page.getByRole("button", {
      name: "Current section: Statistics",
    });
    await expect(section).toBeVisible();
    await section.click();
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
    await page.keyboard.press("Escape");
    const switcher = page.getByRole("button", { name: "Switch course" });
    await page.getByRole("button", { name: "Account menu for Maya" }).focus();
    await page.keyboard.press("Tab");
    await expect(switcher).toBeFocused();
    await expect(switcher).toHaveCSS("outline-style", "solid");
    await expect(page.locator(".app-bar-course")).toHaveCSS(
      "overflow",
      "visible",
    );
    const tooltip = page.locator(".course-title-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText(mobileCourseName);
    const tooltipBounds = await tooltip.boundingBox();
    expect(tooltipBounds.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBounds.x + tooltipBounds.width).toBeLessThanOrEqual(width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: resolve(evidence, `header-${width}.png`),
      fullPage: true,
    });
  });
}

for (const [startWidth, endWidth] of [
  [1024, 390],
  [390, 1024],
]) {
  for (const focusedTarget of ["trigger", "course link"]) {
    test(`course switcher ${focusedTarget} retains focus across ${startWidth} to ${endWidth}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: startWidth, height: 844 });
      await mockApi(page);
      let courseRequests = 0;
      await page.route("**/api/v1/courses", (route) => {
        courseRequests++;
        return route.fulfill({
          json: {
            data: [
              { id: "course-1", name: courseName, status: "active" },
              { id: "course-2", name: "Second course", status: "active" },
            ],
            page: { nextCursor: null, hasMore: false },
          },
        });
      });
      await page.goto(`${origin}/courses/course-1/statistics`);
      const switcher = page.getByRole("button", { name: "Switch course" });
      await switcher.click();
      const courseLink = page.getByRole("link", { name: /Second course/ });
      await expect(courseLink).toBeVisible();
      const focused = focusedTarget === "trigger" ? switcher : courseLink;
      await focused.focus();
      await expect(focused).toBeFocused();
      const loadedRequests = courseRequests;
      await page.setViewportSize({ width: endWidth, height: 844 });
      await expect
        .poll(() =>
          page.locator(".app-bar-inner").evaluate((inner) => {
            const controls = inner.querySelector(".account-controls");
            const course = inner.querySelector(".app-bar-course");
            return Boolean(
              controls &&
              course &&
              controls.compareDocumentPosition(course) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            );
          }),
        )
        .toBe(endWidth <= 850);
      await expect(focused).toBeVisible();
      await expect(focused).toBeFocused();
      await expect(switcher).toHaveAttribute("aria-expanded", "true");
      await expect(courseLink).toBeVisible();
      expect(courseRequests).toBe(loadedRequests);
      await page.screenshot({
        path: resolve(
          evidence,
          `switcher-${focusedTarget.replace(" ", "-")}-${startWidth}-to-${endWidth}.png`,
        ),
        fullPage: true,
      });
    });
  }
  test(`pending sign-out survives ${startWidth} to ${endWidth} breakpoint`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: startWidth, height: 844 });
    await mockApi(page);
    let requests = 0;
    let completeSignOut;
    await page.route("**/api/v1/sessions/current", async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      requests++;
      await new Promise((resolve) => {
        completeSignOut = resolve;
      });
      await route.fulfill({ status: 204, body: "" });
    });
    await page.goto(`${origin}/courses/course-1/statistics`);
    const avatar = page.getByRole("button", { name: "Account menu for Maya" });
    await avatar.click();
    const signOut = page.getByRole("button", { name: "Sign out" });
    await signOut.click();
    await expect.poll(() => requests).toBe(1);
    await expect(
      page.getByRole("button", { name: "Signing out…" }),
    ).toBeDisabled();
    await avatar.focus();
    await expect(avatar).toBeFocused();
    await page.setViewportSize({ width: endWidth, height: 844 });
    await expect(avatar).toBeVisible();
    const pending = page.getByRole("button", { name: "Signing out…" });
    await expect(pending).toBeDisabled();
    await expect(avatar).toBeFocused();
    expect(requests).toBe(1);
    completeSignOut();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    expect(requests).toBe(1);
  });
}

test("mobile wide math and table remain inside page with scroll cue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  await page.evaluate(() => document.fonts.ready);
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
  await expect
    .poll(() => table.evaluate((node) => node.scrollWidth - node.clientWidth))
    .toBeGreaterThan(1);
  await table.focus();
  await expect(table).toBeFocused();
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

test("desktop course title shares the inline navigation row and reveals full name", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page, post, longCourseName);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  const title = page.locator(".app-bar-course h1");
  await expect(title).toHaveText(longCourseName);
  expect(await title.getAttribute("title")).toBeNull();
  await expect(
    page.getByRole("button", { name: "Switch course" }),
  ).toHaveAttribute("title", longCourseName);
  expect((await title.boundingBox()).width).toBeGreaterThan(200);
  expect(
    await title.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
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
  await expect(page.locator(".course-title-tooltip")).toHaveText(
    longCourseName,
  );
  await page.screenshot({
    path: resolve(evidence, "desktop-title.png"),
    fullPage: true,
  });
});

test("course switcher waits for unsaved edit confirmation before navigating", async ({
  page,
}) => {
  await mockApi(page, {
    ...post,
    author: { ...post.author, userId: "u1" },
  });
  await page.route("**/api/v1/courses", (route) =>
    route.fulfill({
      json: {
        data: [
          { id: "course-1", name: courseName, status: "active" },
          { id: "course-2", name: "Second course", status: "active" },
        ],
        page: { nextCursor: null, hasMore: false },
      },
    }),
  );
  await page.route("**/api/v1/courses/course-2", (route) =>
    route.fulfill({
      json: {
        data: { id: "course-2", name: "Second course", status: "active" },
      },
    }),
  );
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  await page.getByRole("button", { name: "Edit post", exact: true }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Unsaved title");

  const switcher = page.getByRole("button", { name: "Switch course" });
  await switcher.click();
  const otherCourse = page.getByRole("link", { name: /Second course/ });
  await expect(otherCourse).toBeVisible();
  const rejectedNavigation = otherCourse.click();
  const confirmation = page.getByRole("dialog", { name: "Confirm action" });
  await expect(confirmation).toContainText("Discard your unsaved post edits?");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await rejectedNavigation;
  await expect(page).toHaveURL(/\/courses\/course-1\/posts\/p1$/);
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Unsaved title",
  );
  await page.screenshot({
    path: resolve(evidence, "switcher-unsaved-preserved.png"),
    fullPage: true,
  });

  await switcher.click();
  const acceptedNavigation = page
    .getByRole("link", { name: /Second course/ })
    .click();
  await expect(confirmation).toContainText("Discard your unsaved post edits?");
  await confirmation.getByRole("button", { name: "Confirm" }).click();
  await acceptedNavigation;
  await expect(page).toHaveURL(/\/courses\/course-2$/);
  await expect(
    page.getByRole("heading", { name: "Second course" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "switcher-navigation-confirmed.png"),
    fullPage: true,
  });
});

test("two-stage header aligns a wide short-name course to its detail pane", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, post, "CSE 214");
  await page.goto(`${origin}/courses/course-1`);
  await expect(
    page.getByRole("heading", { name: "CSE 214", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const nav = page.getByRole("navigation", { name: "Course navigation" });
  const detail = page.getByRole("region", { name: "Post detail" });
  await expect(detail).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "two-stage-1280-short.png"),
    fullPage: true,
  });
  await expect
    .poll(async () =>
      Math.abs((await nav.boundingBox()).x - (await detail.boundingBox()).x),
    )
    .toBeLessThanOrEqual(2);
  const selector = page.getByRole("button", { name: "Switch course" });
  const title = page.getByRole("heading", { name: "CSE 214", exact: true });
  // A short name and its chevron must not become a large empty click target.
  expect(
    (await selector.boundingBox()).width - (await title.boundingBox()).width,
  ).toBeLessThan(32);
  expect((await selector.boundingBox()).width).toBeLessThan(150);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

for (const width of [851, 1280, 1600]) {
  for (const [nameKey, name] of [
    ["short", "CSE 214"],
    ["long", longCourseName],
  ]) {
    for (const selected of [false, true]) {
      test(`two-stage ${width} ${nameKey} ${selected ? "selected" : "unselected"}: labels fit without overlap`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await mockApi(page, post, name);
        await page.goto(
          `${origin}/courses/course-1${selected ? "/posts/p1" : ""}`,
        );
        const title = page.getByRole("heading", { name, exact: true });
        await expect(title).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const nav = page.getByRole("navigation", { name: "Course navigation" });
        const detail = page.getByRole("region", { name: "Post detail" });
        await expect(detail).toBeVisible();
        if (selected)
          await expect(
            page.getByRole("heading", {
              name: "0 Followup Discussions",
              exact: true,
            }),
          ).toBeVisible();
        if (width >= 1280) {
          await expect
            .poll(async () =>
              Math.abs(
                (await nav.boundingBox()).x - (await detail.boundingBox()).x,
              ),
            )
            .toBeLessThanOrEqual(2);
        } else {
          const selector = page.locator(".app-bar-course");
          await expect
            .poll(async () => {
              const a = await selector.boundingBox(),
                b = await nav.boundingBox();
              return b.x - a.x - a.width;
            })
            .toBeGreaterThanOrEqual(6);
          const a = await selector.boundingBox(),
            b = await nav.boundingBox();
          expect(b.x - a.x - a.width).toBeLessThanOrEqual(17);
          expect(b.x).toBeLessThan((await detail.boundingBox()).x);
        }
        const navBox = await nav.boundingBox();
        const links = nav.getByRole("link");
        await expect(links).toHaveCount(6);
        for (const link of await links.all()) {
          const box = await link.boundingBox();
          expect(Math.abs(box.y - navBox.y)).toBeLessThanOrEqual(2);
          expect(
            await link.evaluate((node) => node.scrollWidth - node.clientWidth),
          ).toBeLessThanOrEqual(1);
        }
        const account = await page.locator(".account-controls").boundingBox();
        expect(navBox.x + navBox.width).toBeLessThanOrEqual(account.x);
        if (nameKey === "short") {
          // Integer scrollWidth/clientWidth can agree while fractional glyphs are clipped.
          const visibleText = await title.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const style = getComputedStyle(node);
            return {
              glyphs: range.getBoundingClientRect().width,
              available:
                node.getBoundingClientRect().width -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight),
            };
          });
          expect(visibleText.glyphs).toBeLessThanOrEqual(
            visibleText.available + 0.01,
          );
          expect(
            (
              await page
                .getByRole("button", { name: "Switch course" })
                .boundingBox()
            ).width,
          ).toBeLessThan(150);
        }
        await page.screenshot({
          path: resolve(
            evidence,
            `two-stage-${width}-${nameKey}-${selected ? "selected" : "unselected"}.png`,
          ),
          fullPage: true,
        });
        const switcher = page.getByRole("button", { name: "Switch course" });
        await switcher.focus();
        await expect(switcher).toBeFocused();
        await expect(page.locator(".course-title-tooltip")).toHaveText(name);
        await expect(page.locator(".course-title-tooltip")).toBeVisible();
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: resolve(
            evidence,
            `two-stage-${width}-${nameKey}-${selected ? "selected" : "unselected"}-full-title.png`,
          ),
          fullPage: true,
        });
      });
    }
  }
}

test("two-stage layout responds to actual unread content at a fixed desktop width without losing focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await mockApi(page, post, "CSE 214");
  let releaseUnread;
  await page.route("**/threads/unread-count", async (route) => {
    await new Promise((resolve) => {
      releaseUnread = resolve;
    });
    await route.fulfill({ json: { data: { count: 99999999 } } });
  });
  await page.goto(`${origin}/courses/course-1`);
  const nav = page.getByRole("navigation", { name: "Course navigation" });
  const detail = page.getByRole("region", { name: "Post detail" });
  await expect(detail).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(async () =>
      Math.abs((await nav.boundingBox()).x - (await detail.boundingBox()).x),
    )
    .toBeLessThanOrEqual(2);
  const switcher = page.getByRole("button", { name: "Switch course" });
  await switcher.focus();
  await expect.poll(() => typeof releaseUnread).toBe("function");
  releaseUnread();
  await expect(
    page.getByLabel("99999999 unread Thread messages"),
  ).toBeVisible();
  await expect
    .poll(async () => (await nav.boundingBox()).x)
    .toBeLessThan((await detail.boundingBox()).x - 20);
  await expect(switcher).toBeFocused();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: resolve(evidence, "two-stage-content-change-fixed-1000.png"),
    fullPage: true,
  });
});

test("editing a post does not remeasure the course header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockApi(page, post, "CSE 214");
  await page.goto(`${origin}/courses/course-1`);
  await expect(page.getByRole("region", { name: "Post detail" })).toBeVisible();
  await page.getByRole("button", { name: "New post", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Post body" });
  await expect(editor).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const inner = document.querySelector(".app-bar-inner");
    const original = Element.prototype.getBoundingClientRect;
    window.headerMeasurements = 0;
    Element.prototype.getBoundingClientRect = function () {
      if (this === inner) window.headerMeasurements++;
      return original.call(this);
    };
  });
  await editor.fill("Typing in the post editor must not measure the header.");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(await page.evaluate(() => window.headerMeasurements)).toBe(0);
});

for (const width of [320, 390]) {
  for (const role of ["student", "instructor"]) {
    test(`two-stage mobile unchanged ${width} ${role} dropdown`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockApi(page, post, longCourseName, role);
      await page.goto(`${origin}/courses/course-1`);
      const trigger = page.getByRole("button", {
        name: "Current section: Discussion",
      });
      await trigger.click();
      const nav = page.getByRole("navigation", { name: "Course navigation" });
      await expect(nav).toBeVisible();
      await expect(
        nav.getByRole("link", { name: "Discussion", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link")).toHaveCount(6);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: resolve(
          evidence,
          `two-stage-mobile-${width}-${role}-dropdown.png`,
        ),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(nav).toBeHidden();
    });
  }
}

async function expectCompactSplit(page, width, rem = 16) {
  const grid = await page.locator(".discussion-columns").boundingBox();
  const feed = await page.locator(".discussion-feed").boundingBox();
  const detail = await page
    .getByRole("region", { name: "Post detail" })
    .boundingBox();
  const expected = Math.min(24 * rem, Math.max(20 * rem, grid.width * 0.288));
  expect(Math.abs(feed.width - expected)).toBeLessThanOrEqual(1);
  expect(Math.abs(feed.x + feed.width - detail.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(detail.x + detail.width - width)).toBeLessThanOrEqual(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
}

for (const width of [851, 1024, 1280, 1440, 1600]) {
  for (const selected of [false, true]) {
    test(`compact post-list ${width} ${selected ? "selected" : "unselected"} geometry and controls`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const fixturePost = selected
        ? {
            ...post,
            type: "question",
            title:
              "Explain the complete sequence of rotations and rebalancing in a long data structures question",
            answered: false,
            pinned: true,
          }
        : post;
      await mockApi(page, fixturePost, longCourseName);
      await page.goto(
        `${origin}/courses/course-1${selected ? "/posts/p1" : ""}`,
      );
      await expect(
        page.getByRole("region", { name: "Post detail" }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectCompactSplit(page, width);
      const search = page.getByRole("searchbox", { name: "Search posts" });
      const filters = page.getByRole("button", {
        name: "Filters",
        exact: true,
      });
      const compose = page.getByRole("button", {
        name: "New post",
        exact: true,
      });
      const feed = await page.locator(".discussion-feed").boundingBox();
      for (const control of [search, filters, compose]) {
        await control.focus();
        await expect(control).toBeFocused();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(feed.x);
        expect(box.x + box.width).toBeLessThanOrEqual(feed.x + feed.width);
        // Search retains its existing inset input inside the 44px field.
        const target = control === search ? page.getByRole("search") : control;
        expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      if (selected)
        await expect(
          page.getByRole("heading", { name: fixturePost.title, exact: true }),
        ).toBeVisible();
      const card = page.locator(".discussion-feed .post-card").first();
      await expect(card).toHaveAccessibleName(new RegExp(fixturePost.title));
      if (selected) {
        await expect(
          card.getByText("Unanswered", { exact: true }),
        ).toBeVisible();
        const titleBox = await card.locator(".post-card-title").boundingBox();
        const statusBox = await card.locator(".post-statuses").boundingBox();
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(
          statusBox.x + 1,
        );
      }
      await page.screenshot({
        path: resolve(
          evidence,
          `compact-post-list-${width}-${selected ? "selected" : "unselected"}.png`,
        ),
        fullPage: true,
      });
      await filters.click();
      const overlay = page.getByRole("dialog", { name: "Filters" });
      await expect(overlay).toBeVisible();
      const box = await overlay.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(filters).toBeFocused();
    });
  }
}

test("compact post-list header follows live geometry, rem changes and section replacement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockApi(page, post, "CSE 214");
  await page.goto(`${origin}/courses/course-1`);
  const detail = page.getByRole("region", { name: "Post detail" });
  const nav = page.getByRole("navigation", { name: "Course navigation" });
  await expect(detail).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const search = page.getByRole("searchbox", { name: "Search posts" });
  await search.focus();
  await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
  await expect
    .poll(async () =>
      Math.abs((await nav.boundingBox()).x - (await detail.boundingBox()).x),
    )
    .toBeLessThanOrEqual(1);
  await expectCompactSplit(page, 1600, 20);
  await expect(search).toBeFocused();
  await page.screenshot({
    path: resolve(evidence, "compact-post-list-root-font.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "16px";
    document.querySelector(".discussion-columns").style.width = "1200px";
  });
  await expect
    .poll(async () => (await detail.boundingBox()).x)
    .toBeCloseTo(345.6, 0);
  await expect
    .poll(async () =>
      Math.abs((await nav.boundingBox()).x - (await detail.boundingBox()).x),
    )
    .toBeLessThanOrEqual(1);
  await expect(search).toBeFocused();
  await nav.getByRole("link", { name: "Course settings", exact: true }).click();
  await expect(page.locator(".discussion-columns")).toHaveCount(0);
  await expect
    .poll(async () => (await nav.boundingBox()).x)
    .toBeCloseTo(384, 0);
  await page.screenshot({
    path: resolve(evidence, "compact-post-list-other-section.png"),
    fullPage: true,
  });
  await nav.getByRole("link", { name: "Discussion", exact: true }).click();
  await expect(detail).toBeVisible();
  await expectCompactSplit(page, 1600);
  await expect
    .poll(async () =>
      Math.abs((await nav.boundingBox()).x - (await detail.boundingBox()).x),
    )
    .toBeLessThanOrEqual(1);
});

for (const width of [320, 390, 850]) {
  test(`compact post-list mobile ${width} retains full-width feed and back`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, post, longCourseName);
    await page.goto(`${origin}/courses/course-1`);
    const feed = page.locator(".discussion-feed");
    await expect(feed).toBeVisible();
    expect((await feed.boundingBox()).width).toBe(width);
    await page
      .getByRole("link", { name: new RegExp(post.title) })
      .first()
      .click();
    await expect(
      page.getByRole("region", { name: "Post detail" }),
    ).toBeVisible();
    await expect(feed).toBeHidden();
    await page.getByRole("button", { name: /back to posts/i }).click();
    await expect(feed).toBeVisible();
    expect((await feed.boundingBox()).width).toBe(width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({
      path: resolve(evidence, `compact-post-list-mobile-${width}.png`),
      fullPage: true,
    });
  });
}
