import process from "node:process";
import { URL } from "node:url";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const base = process.env.FEED_BROWSER_URL ?? "http://localhost:5174";
const screenshots = resolve(
  process.env.FEED_SCREENSHOTS_DIR ??
    resolve(import.meta.dirname, "../../docs/pr-screenshots/feed-organization"),
);
mkdirSync(screenshots, { recursive: true });
const courseId = "01a0e5cc-58ae-7009-9f43-d5453c12bca9";
const userId = "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c";
const p1 = "01a0e5cc-58ae-7009-9f43-c8155fb2359f";
const p2 = "01a0e5cc-58ae-7009-9f43-ddd412c3880b";
const date = "2026-10-21T12:00:00.000Z";
const course = {
  id: courseId,
  name: "Physics",
  status: "active",
  organizationId: "org",
  joinCode: null,
  createdAt: date,
  updatedAt: date,
  version: 1,
};
const post = (id, title, saved = false) => ({
  id,
  courseId,
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: "Discussion body",
  author: { userId, displayName: "Student", anonymous: false, deleted: false },
  anonymous: false,
  tags: [],
  attachments: [],
  createdAt: date,
  updatedAt: date,
  lastActivityAt: date,
  version: 1,
  following: true,
  unread: false,
  saved,
  answered: false,
  unresolvedFollowups: 0,
  pinned: false,
  duplicateStatus: "none",
});

async function mockApi(page, state) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, headers = {}) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });
    if (path.endsWith("/sessions/current"))
      return json({
        data: {
          id: "session",
          user: {
            id: userId,
            displayName: "Student",
            email: "student@example.edu",
            createdAt: date,
            updatedAt: date,
            version: 1,
          },
          expiresAt: "2027-01-01T00:00:00.000Z",
          csrfToken: "csrf",
        },
      });
    if (path.endsWith(`/courses/${courseId}`)) return json({ data: course });
    if (path.endsWith(`/members/${userId}`))
      return json({
        data: { role: "student", user: { id: userId, displayName: "Student" } },
      });
    if (path.endsWith("/notifications/unread-count"))
      return json({ data: { count: 0 } });
    if (path.endsWith(`/posts/${p1}/saved`)) {
      state.saved = request.method() === "PUT";
      return json({ data: { saved: state.saved } });
    }
    if (path.endsWith(`/posts/${p1}`))
      return json({ data: post(p1, "Original question", state.saved) });
    if (path.endsWith("/posts/new-count")) {
      state.countChecks = (state.countChecks ?? 0) + 1;
      return json({ data: { count: state.released ? 0 : state.newCount } });
    }
    if (path.endsWith(`/courses/${courseId}/posts`)) {
      state.feedLoads++;
      if (state.holdInitial && state.feedLoads === 1) await state.holdInitial;
      const items = state.released
        ? [
            post(p2, "New matching question"),
            post(p1, "Original question", state.saved),
          ]
        : [post(p1, "Original question", state.saved)];
      return json(
        {
          data:
            url.searchParams.get("saved") === "true"
              ? items.filter((item) => item.saved)
              : items,
          page: { nextCursor: null, hasMore: false },
        },
        { "X-Feed-Snapshot": "snapshot" },
      );
    }
    if (path.includes("/followups"))
      return json({ data: [], page: { nextCursor: null, hasMore: false } });
    if (path.includes("/answers") || path.includes("/sessions"))
      return json({ data: [] });
    return json({ data: [] });
  });
}

test("new-post prompt preserves the current card and selected detail until refresh", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = { saved: false, newCount: 2, feedLoads: 0 };
  await mockApi(page, state);
  await page.goto(`${base}/courses/${courseId}/posts/${p1}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("link", { name: /Original question/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /2 new posts/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Original question" }),
  ).toBeVisible();
  await expect(page.getByText("New matching question")).toHaveCount(0);
  await page.screenshot({ path: resolve(screenshots, "new-post-prompt.png") });
  state.released = true;
  await page.getByRole("button", { name: /2 new posts/ }).click();
  await expect(page.getByText("New matching question")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Original question" }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, "refreshed-feed.png") });
});

test("saved list is personal and saving does not change following", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = { saved: false, newCount: 0, feedLoads: 0 };
  await mockApi(page, state);
  await page.goto(`${base}/courses/${courseId}/posts/${p1}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(
    page.getByRole("button", { name: "Remove saved post" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await page.getByRole("group", { name: "Show" }).getByText("Saved").click();
  await expect(
    page.getByRole("link", { name: /Original question/ }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, "saved-filter.png") });
});

test("nonmatching posts do not prompt and an unsent composer survives refresh", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = { saved: false, newCount: 0, feedLoads: 0 };
  await page.clock.install();
  await mockApi(page, state);
  await page.goto(`${base}/courses/${courseId}?filter=following`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("link", { name: /Original question/ }),
  ).toBeVisible();
  await expect.poll(() => state.countChecks ?? 0).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: /new posts? — refresh feed/ }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "nonmatching-no-prompt.png"),
  });
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Unsent draft title");
  state.newCount = 1;
  await page.clock.runFor(20_100);
  await expect(
    page.getByRole("button", { name: /1 new post — refresh feed/ }),
  ).toBeVisible();
  state.released = true;
  await page.getByRole("button", { name: /1 new post — refresh feed/ }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Unsent draft title",
  );
  await page.screenshot({
    path: resolve(screenshots, "composer-preserved.png"),
  });
});

test("a saved post removed while the initial list is loading does not reappear", async ({
  page,
}) => {
  test.setTimeout(60_000);
  let releaseInitial;
  const state = {
    saved: true,
    newCount: 0,
    feedLoads: 0,
    holdInitial: new Promise((resolve) => {
      releaseInitial = resolve;
    }),
  };
  await mockApi(page, state);
  await page.goto(`${base}/courses/${courseId}/posts/${p1}?filter=saved`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Remove saved post" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove saved post" }).click();
  await expect(page.getByRole("button", { name: "Save post" })).toBeVisible();
  releaseInitial();
  await expect(
    page.getByRole("link", { name: /Original question/ }),
  ).toHaveCount(0);
  await expect(page.getByText("No posts found.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Original question" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "saved-initial-race.png"),
  });
});
