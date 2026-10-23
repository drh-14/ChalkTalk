import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

/* global window, PopStateEvent -- page.evaluate callbacks run in the browser. */

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(root, "docs/pr-screenshots/discussion-locks");
mkdirSync(screenshots, { recursive: true });
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

async function open(
  browser,
  {
    role,
    kind,
    locked,
    delayLock = false,
    secondPost = false,
    staleLockResponse = false,
  },
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let state = locked;
  let version = 1;
  let title =
    kind === "poll" ? "Choose a review day" : "How does refraction work?";
  let releaseLock;
  const lockGate = delayLock
    ? new Promise((resolve) => {
        releaseLock = resolve;
      })
    : null;
  const now = "2026-10-21T00:00:00Z";
  const post = (
    id = kind === "poll" ? "fixture-poll" : "fixture-question",
  ) => ({
    id,
    courseId: "fixture-course",
    type: kind,
    deleted: false,
    title: id === "fixture-second" ? "How does reflection work?" : title,
    bodyMarkdown:
      kind === "poll" ? "Pick a day." : "Discuss the optics example.",
    author: {
      userId: "fixture-student",
      displayName: "Sam Student",
      anonymous: false,
      deleted: false,
    },
    anonymous: false,
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    version: id === "fixture-second" ? 1 : version,
    discussionLocked: id === "fixture-second" ? false : state,
    pinned: false,
    announcement: false,
    private: false,
    duplicateStatus: "none",
    duplicateOfPostId: null,
    answered: false,
    unresolvedFollowups: 0,
    following: false,
    unread: false,
    ...(kind === "poll"
      ? {
          options: [
            { id: "option-1", label: "Monday", voteCount: 1, selected: true },
            { id: "option-2", label: "Tuesday", voteCount: 0, selected: false },
          ],
          totalVotes: 1,
        }
      : {}),
  });
  const mutations = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const fulfill = (data, etag = `"v${version}"`) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: etag },
        body: JSON.stringify({ data }),
      });
    if (path === "/api/v1/courses/fixture-course/members/fixture-staff")
      return fulfill({
        id: "m1",
        courseId: "fixture-course",
        user: { id: "fixture-staff", displayName: "Tutor" },
        role: "ta",
        version: 1,
      });
    if (path === "/api/v1/courses/fixture-course/members/fixture-student")
      return fulfill({
        id: "m2",
        courseId: "fixture-course",
        user: { id: "fixture-student", displayName: "Sam" },
        role: "student",
        version: 1,
      });
    if (path === "/api/v1/courses/fixture-course/posts")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: secondPost ? [post(), post("fixture-second")] : [post()],
          page: { hasMore: false, nextCursor: null },
        }),
      });
    if (
      path === `/api/v1/posts/${post().id}/discussion-lock` &&
      req.method() === "PUT"
    ) {
      mutations.push({
        body: req.postDataJSON(),
        etag: req.headers()["if-match"],
      });
      if (lockGate) await lockGate;
      if (staleLockResponse)
        return fulfill(
          {
            ...post(),
            title: "How does refraction work?",
            version: 2,
            discussionLocked: true,
          },
          '"v2"',
        );
      state = req.postDataJSON().locked;
      version += 1;
      return fulfill(post());
    }
    if (path === `/api/v1/posts/${post().id}/follow`)
      return fulfill({ following: true });
    if (path === `/api/v1/posts/${post().id}`) return fulfill(post());
    if (secondPost && path === "/api/v1/posts/fixture-second")
      return fulfill(post("fixture-second"), '"v1"');
    if (path.includes("/collaboration-sessions"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          page: { hasMore: false, nextCursor: null },
        }),
      });
    if (path.endsWith("/answers")) return fulfill([]);
    if (path.endsWith("/followups"))
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [],
          meta: { total: 0, nextCursor: null },
        }),
      });
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(
    `${origin}/discussion-lock-fixture.html?role=${role}&kind=${kind}`,
  );
  await expect(page.getByRole("heading", { name: post().title })).toBeVisible();
  return {
    context,
    page,
    mutations,
    releaseLock,
    setNewerPost: () => {
      version = 3;
      title = "What is new about refraction?";
    },
  };
}

test("staff locks and unlocks a question without moving it in the feed", async ({
  browser,
}) => {
  const { context, page, mutations } = await open(browser, {
    role: "ta",
    kind: "question",
    locked: false,
  });
  await page.getByRole("button", { name: "Lock discussion" }).click();
  await expect(page.locator(".discussion-lock-notice")).toContainText(
    "Discussion locked",
  );
  await expect(
    page.getByRole("button", { name: "Unlock discussion" }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "staff-locked-question.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Unlock discussion" }).click();
  await expect(
    page.getByRole("button", { name: "Lock discussion" }),
  ).toBeVisible();
  expect(mutations).toEqual([
    { body: { locked: true }, etag: '"v1"' },
    { body: { locked: false }, etag: '"v2"' },
  ]);
  await page.screenshot({
    path: resolve(screenshots, "staff-unlocked-question.png"),
    fullPage: true,
  });
  await context.close();
});

test("student sees locked question without new-discussion controls", async ({
  browser,
}) => {
  const { context, page } = await open(browser, {
    role: "student",
    kind: "question",
    locked: true,
  });
  await expect(
    page.getByText("Discussion locked", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compose a new followup discussion" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lock discussion" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "student-locked-question.png"),
    fullPage: true,
  });
  await context.close();
});

test("student sees poll results without ballot-change controls", async ({
  browser,
}) => {
  const { context, page } = await open(browser, {
    role: "student",
    kind: "poll",
    locked: true,
  });
  await expect(
    page.getByRole("heading", { name: /Poll · 1 vote · locked/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Change vote" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Retract vote" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: resolve(screenshots, "student-locked-poll.png"),
    fullPage: true,
  });
  await context.close();
});

test("following while a lock is pending stays followed after its response", async ({
  browser,
}) => {
  const { context, page, releaseLock } = await open(browser, {
    role: "ta",
    kind: "question",
    locked: false,
    delayLock: true,
  });
  await page.getByRole("button", { name: "Lock discussion" }).click();
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  releaseLock();
  await expect(page.locator(".discussion-lock-notice")).toContainText(
    "Discussion locked",
  );
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "staff-followed-during-lock.png"),
    fullPage: true,
  });
  await context.close();
});

test("a late lock response updates its feed card without replacing another post", async ({
  browser,
}) => {
  const { context, page, releaseLock } = await open(browser, {
    role: "ta",
    kind: "question",
    locked: false,
    delayLock: true,
    secondPost: true,
  });
  await page.getByRole("button", { name: "Lock discussion" }).click();
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("post", "fixture-second");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByRole("heading", { name: "How does reflection work?" }),
  ).toBeVisible();
  releaseLock();
  await expect(
    page.getByRole("heading", { name: "How does reflection work?" }),
  ).toBeVisible();
  await expect(page.getByText("Loading post…")).toHaveCount(0);
  await expect(page.locator(".post-card").first()).toContainText(
    "Discussion locked",
  );
  await page.screenshot({
    path: resolve(screenshots, "staff-navigated-during-lock.png"),
    fullPage: true,
  });
  await context.close();
});

test("a stale lock response does not overwrite a newer post detail", async ({
  browser,
}) => {
  const { context, page, releaseLock, setNewerPost } = await open(browser, {
    role: "ta",
    kind: "question",
    locked: false,
    delayLock: true,
    secondPost: true,
    staleLockResponse: true,
  });
  const navigate = async (id, query = null) => {
    await page.evaluate(
      ({ postId, search }) => {
        const url = new URL(window.location.href);
        url.searchParams.set("post", postId);
        if (search) url.searchParams.set("q", search);
        window.history.pushState({}, "", url);
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
      { postId: id, search: query },
    );
  };
  await page.getByRole("button", { name: "Lock discussion" }).click();
  await navigate("fixture-second");
  await expect(
    page.getByRole("heading", { name: "How does reflection work?" }),
  ).toBeVisible();
  setNewerPost();
  await navigate("fixture-question", "new");
  await expect(
    page.getByRole("heading", { name: "What is new about refraction?" }),
  ).toBeVisible();
  await expect(page.locator(".post-card").first()).toContainText(
    "What is new about refraction?",
  );
  const response = page.waitForResponse((response) =>
    response.url().endsWith("/discussion-lock"),
  );
  releaseLock();
  await response;
  await expect(
    page.getByRole("heading", { name: "What is new about refraction?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lock discussion" }),
  ).toBeVisible();
  await expect(page.locator(".discussion-lock-notice")).toHaveCount(0);
  await expect(page.locator(".post-card").first()).not.toContainText(
    "Discussion locked",
  );
  await page.screenshot({
    path: resolve(screenshots, "staff-newer-post-after-stale-lock.png"),
    fullPage: true,
  });
  await context.close();
});
