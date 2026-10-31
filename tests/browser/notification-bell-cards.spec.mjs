import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(
  root,
  "docs/pr-screenshots/notification-bell-cards",
);
mkdirSync(screenshots, { recursive: true });
let vite;
let origin;
const courseId = "01a0e5cc-58ae-7009-9f43-d5453c12bca9";
const userId = "01a0e5cc-58ae-7009-9f43-cd86eb2ae79c";
const postId = "01a0e5cc-58ae-7009-9f43-c8155fb2359f";
const now = "2026-10-27T12:00:00Z";
const course = {
  id: courseId,
  name: "CS 101",
  status: "active",
  organizationId: "org",
  joinCode: null,
  allowAnonymousPosting: true,
  allowPrivatePosting: true,
  allowFollowupResolution: true,
  createdAt: now,
  updatedAt: now,
  version: 1,
};
const post = {
  id: postId,
  courseId,
  type: "question",
  deleted: false,
  title: "Why does my loop never stop?",
  bodyMarkdown: "I expected the loop to stop after the base case.",
  author: { userId, displayName: "Student", anonymous: false, deleted: false },
  anonymous: false,
  tags: [],
  attachments: [],
  createdAt: now,
  updatedAt: now,
  lastActivityAt: now,
  version: 1,
  following: true,
  unread: false,
  answered: false,
  unresolvedFollowups: 0,
  pinned: false,
  duplicateStatus: "none",
};
const answer = {
  id: "answer-1",
  postId,
  kind: "staff",
  deleted: false,
  bodyMarkdown: "Add a base case.\nThen stop recurring.",
  contributors: [{ id: "grace", displayName: "Grace" }],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: now,
  updatedAt: now,
  version: 1,
  canEdit: false,
  upvoteCount: 0,
  viewerUpvoted: false,
};
const card = (id, kind, extra = {}) => ({
  id,
  kind,
  courseId,
  courseName: "CS 101",
  postId,
  postTitle: "Why does my loop never stop?",
  actor: { displayName: "Grace" },
  preview: null,
  responseUnavailable: false,
  addressedToOwner: false,
  destination: { kind: "post", postId },
  createdAt: now,
  readAt: null,
  ...extra,
});
const first = [
  card("n1", "answer_created", {
    preview: "Add a base case.\nThen stop recurring.",
    addressedToOwner: true,
    destination: { kind: "answer", postId, responseId: "answer-1" },
  }),
  card("n2", "reply_created", {
    actor: { displayName: "Anonymous" },
    preview: null,
    responseUnavailable: true,
  }),
  card("n3", "post_staff_edited", { actor: { displayName: "Tara TA" } }),
];
const second = [
  card("n4", "post_merged", {
    actor: { displayName: "Tara TA" },
    destination: { kind: "post", postId: "canonical-1" },
  }),
  card("n5", "post_staff_deleted", {
    actor: { displayName: "Tara TA" },
    postTitle: null,
    destination: { kind: "course", courseId },
  }),
];

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

async function open(page, failOnce = false) {
  let nextCalls = 0;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, headers = {}) =>
      route.fulfill({
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
            createdAt: now,
            updatedAt: now,
            version: 1,
          },
          expiresAt: "2027-01-01T00:00:00Z",
          csrfToken: "fixture-csrf",
        },
      });
    if (path.endsWith(`/courses/${courseId}`)) return json({ data: course });
    if (path.endsWith(`/members/${userId}`))
      return json({
        data: { role: "student", user: { id: userId, displayName: "Student" } },
      });
    if (path.endsWith(`/courses/${courseId}/posts`))
      return json(
        { data: [post], page: { nextCursor: null, hasMore: false } },
        { "X-Feed-Snapshot": "snapshot" },
      );
    if (path.endsWith(`/courses/${courseId}/posts/new-count`))
      return json({ data: { count: 0 } });
    if (path.endsWith(`/posts/${postId}`)) return json({ data: post });
    if (path.endsWith(`/posts/${postId}/answers`))
      return json({ data: [answer] });
    if (path.endsWith(`/posts/${postId}/followups`))
      return json({ data: [], meta: { total: 0, nextCursor: null } });
    if (path.endsWith(`/courses/${courseId}/collaboration-sessions`))
      return json({ data: [], page: { nextCursor: null, hasMore: false } });
    if (path.endsWith(`/courses/${courseId}/threads/unread-count`))
      return json({ data: { count: 0 } });
    if (path.endsWith(`/courses/${courseId}/post-folders`))
      return json({ data: [] });
    if (path.endsWith("/notifications/unread-count"))
      return route.fulfill({ json: { data: { count: 5 } } });
    if (path.endsWith("/notifications/read"))
      return route.fulfill({ status: 204 });
    if (path.endsWith("/notifications") && url.searchParams.has("cursor")) {
      nextCalls += 1;
      if (failOnce && nextCalls === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Please retry" } },
        });
      return route.fulfill({
        json: { data: second, page: { nextCursor: null, hasMore: false } },
      });
    }
    if (path.endsWith("/notifications"))
      return json({ data: first, page: { nextCursor: "next", hasMore: true } });
    throw new Error(`Unexpected API request: ${path}`);
  });
  await page.goto(`${origin}/courses/${courseId}`);
  await expect(page.getByRole("heading", { name: "CS 101" })).toBeVisible();
  await page.getByRole("button", { name: "Notifications, 5 unread" }).click();
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem"),
  ).toHaveCount(3);
}

test("response, unavailable response, and moderation cards are accessible and paginated", async ({
  page,
}) => {
  await open(page);
  const panel = page.getByRole("region", { name: "Notifications" });
  await expect(panel.getByText("Grace replied to your message")).toBeVisible();
  await expect(panel.getByText("Add a base case.")).toBeVisible();
  await expect(panel.getByText("Response no longer available")).toBeVisible();
  await expect(panel.getByText(/Tara TA edited your post/)).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "response-and-edit.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Load more" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(5);
  await expect(
    panel.getByText(/marked your question as a duplicate/),
  ).toBeVisible();
  await expect(panel.getByText("Tara TA deleted your post")).toBeVisible();
  await expect(panel.getByText("Why does my loop never stop?")).toHaveCount(4);
  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.screenshot({
    path: resolve(screenshots, "merge-and-delete.png"),
    fullPage: true,
  });
  await panel.getByRole("listitem").first().getByRole("button").click();
  await expect(page).toHaveURL(
    `${origin}/courses/${courseId}/posts/${postId}#answer-answer-1`,
  );
  const destination = page.locator("#answer-answer-1");
  await expect(destination).toContainText("Add a base case.");
  await expect(destination).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "exact-answer-destination.png"),
    fullPage: true,
  });
});

test("page failure preserves cards and offers retry", async ({ page }) => {
  await open(page, true);
  const panel = page.getByRole("region", { name: "Notifications" });
  await panel.getByRole("button", { name: "Load more" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Please retry");
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  await page.screenshot({
    path: resolve(screenshots, "retryable-error.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Load more" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(5);
});
