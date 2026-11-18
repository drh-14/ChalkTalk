import { mkdirSync } from "node:fs";
import { URL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(
  root,
  "test-results/browser-screenshots/note-followups",
);
mkdirSync(screenshots, { recursive: true });
let vite, origin;
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

const course = "course-1";
const note = {
  id: "note-1",
  courseId: course,
  type: "note",
  deleted: false,
  title: "M5/M6 notes",
  bodyMarkdown: "The final presentation is the poster session.",
  author: {
    userId: "prof",
    displayName: "Shuai Mu",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  folder: null,
  attachments: [],
  pinned: false,
  private: false,
  unread: false,
  following: false,
  createdAt: "2026-11-13T15:00:00Z",
  lastActivityAt: "2026-11-15T15:00:00Z",
  version: 1,
  anchor: null,
};
const followup = (id, parentId, author, body, extra = {}) => ({
  id,
  postId: note.id,
  parentId,
  author,
  anonymous: author === null,
  bodyMarkdown: body,
  attachments: [],
  deleted: false,
  createdAt: "2026-11-15T15:00:00Z",
  updatedAt: "2026-11-15T15:00:00Z",
  version: 1,
  canEdit: false,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount: 0,
  ...extra,
});
const roots = [
  followup("f1", null, null, "Can we use slides to show our ongoing efforts?", {
    replyCount: 1,
    resolved: true,
  }),
  followup("f2", null, null, "Is there a final presentation after M6?", {
    replyCount: 1,
    resolved: true,
  }),
];
const replies = {
  f1: [followup("r1", "f1", { id: "prof", displayName: "Shuai Mu" }, "yes")],
  f2: [
    followup(
      "r2",
      "f2",
      { id: "prof", displayName: "Shuai Mu" },
      "Is the poster session",
    ),
  ],
};

async function mockApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/v1/sessions/current")
      return json({
        data: {
          id: "session",
          user: {
            id: "u1",
            displayName: "Maya Chen",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === `/api/v1/courses/${course}`)
      return route.fulfill({
        status: 200,
        json: {
          data: {
            id: course,
            name: "CSE 416 Software Engineering",
            status: "active",
            allowAnonymousPosting: true,
            allowPrivatePosting: true,
            allowFollowupResolution: true,
          },
        },
        headers: { ETag: '"v1"' },
      });
    if (path.endsWith("/members/u1"))
      return json({ data: { role: "student" } });
    if (path === `/api/v1/courses/${course}/posts`)
      return json({ data: [note], page: { hasMore: false, nextCursor: null } });
    if (path === `/api/v1/posts/${note.id}`)
      return route.fulfill({
        status: 200,
        json: { data: note },
        headers: { ETag: '"v1"' },
      });
    if (path === `/api/v1/posts/${note.id}/followups`)
      return json({
        data: roots,
        meta: { total: roots.length, nextCursor: null },
      });
    const thread = path.match(/^\/api\/v1\/followups\/([^/]+)\/replies$/);
    if (thread)
      return json({
        data: replies[thread[1]] ?? [],
        meta: { total: (replies[thread[1]] ?? []).length, nextCursor: null },
      });
    if (path.endsWith("/answers"))
      return json(
        {
          error: { code: "not_a_question", message: "Post is not a question" },
        },
        422,
      );
    if (path.endsWith("/unread-count")) return json({ data: { count: 0 } });
    return json({ data: [], page: { hasMore: false, nextCursor: null } });
  });
}

for (const [size, viewport] of [
  ["desktop", { width: 1536, height: 864 }],
  ["phone", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport, ignoreHTTPSErrors: true });

    test("a note shows its followup discussions and replies, without answers", async ({
      page,
    }) => {
      await mockApi(page);
      await page.goto(`${origin}/courses/${course}/posts/${note.id}`);
      const detail = page.getByRole("region", { name: "Post detail" });
      await expect(
        detail.getByRole("heading", { name: "M5/M6 notes" }),
      ).toBeVisible({
        timeout: 30000,
      });
      await expect(
        detail.getByRole("heading", { name: /2 Followup Discussions/ }),
      ).toBeVisible();
      await expect(
        detail.getByText("Can we use slides to show our ongoing efforts?"),
      ).toBeVisible();
      await expect(
        detail.getByText("Is there a final presentation after M6?"),
      ).toBeVisible();
      // Replies stay collapsed until shown, as on questions.
      const discussions = detail.getByRole("article", {
        name: "Followup by Anonymous",
      });
      await expect(discussions).toHaveCount(2);
      for (const [index, reply] of [
        [0, "yes"],
        [1, "Is the poster session"],
      ]) {
        const discussion = discussions.nth(index);
        await discussion
          .getByRole("button", { name: "Show 1 replies" })
          .click();
        await expect(
          discussion.getByRole("article", { name: "Followup by Shuai Mu" }),
        ).toContainText(reply);
      }
      await expect(
        detail.getByRole("region", { name: "Students' answer" }),
      ).toHaveCount(0);
      await expect(
        detail.getByRole("region", { name: "Instructors' answer" }),
      ).toHaveCount(0);
      await detail
        .getByRole("heading", { name: /Followup Discussions/ })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(screenshots, `${size}-note-followups.png`),
      });
    });
  });
}
