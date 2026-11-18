import { mkdirSync } from "node:fs";
import { URL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(
  root,
  "test-results/browser-screenshots/long-code-answers",
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
const longLine =
  "You are this project's worker. Keep three layers in line with each other, and do one step of that work in this turn, then report what changed and what is left.";
const question = {
  id: "q-1",
  courseId: course,
  type: "question",
  deleted: false,
  title: "How to implement the loop function in LLM",
  bodyMarkdown: "How do you craft a prompt to do this?",
  author: {
    userId: null,
    displayName: "Anonymous",
    anonymous: true,
    deleted: false,
  },
  anonymous: true,
  tags: ["project"],
  folder: null,
  attachments: [],
  answered: true,
  unresolvedFollowups: 0,
  pinned: false,
  private: false,
  unread: false,
  following: false,
  createdAt: "2026-11-13T15:00:00Z",
  lastActivityAt: "2026-11-14T15:00:00Z",
  version: 1,
  anchor: null,
};
const answer = (id, kind, bodyMarkdown) => ({
  id,
  postId: question.id,
  kind,
  deleted: false,
  bodyMarkdown,
  contributors: [
    { id: "a", displayName: kind === "staff" ? "Shuai Mu" : "Darren Hamilton" },
  ],
  anonymous: false,
  attachments: [],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-11-14T15:00:00Z",
  updatedAt: "2026-11-14T15:00:00Z",
  version: 1,
  canEdit: false,
  upvoteCount: 0,
  viewerUpvoted: false,
});

async function mockApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, json: body, headers });
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
      return json(
        {
          data: {
            id: course,
            name: "CSE 416 Software Engineering",
            status: "active",
            allowAnonymousPosting: true,
            allowPrivatePosting: true,
            allowFollowupResolution: true,
          },
        },
        200,
        { ETag: '"v1"' },
      );
    if (path.endsWith("/members/u1"))
      return json({ data: { role: "student" } });
    if (path === `/api/v1/courses/${course}/posts`)
      return json({
        data: [question],
        page: { hasMore: false, nextCursor: null },
      });
    if (path === `/api/v1/posts/${question.id}`)
      return json({ data: question }, 200, { ETag: '"v1"' });
    if (path === `/api/v1/posts/${question.id}/answers`)
      return json({
        data: [
          answer(
            "s1",
            "student",
            `What do you mean exactly? ${"Generally for loops you give it some setup. ".repeat(6)}`,
          ),
          answer(
            "i1",
            "staff",
            `FYI here is the loop prompt I use.\n\n\`\`\`\n${longLine}\n${longLine}\n\`\`\``,
          ),
        ],
      });
    if (path.endsWith("/followups"))
      return json({ data: [], meta: { total: 0, nextCursor: null } });
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

    test("a long code block wraps inside its answer instead of widening the page", async ({
      page,
    }) => {
      await mockApi(page);
      await page.goto(`${origin}/courses/${course}/posts/${question.id}`);
      const detail = page.getByRole("region", { name: "Post detail" });
      const instructors = detail.getByRole("region", {
        name: "Instructors' answer",
      });
      await expect(instructors.locator("pre")).toBeVisible({ timeout: 30000 });
      // The code block wraps its long lines, so all of it is readable...
      const code = await instructors.locator("pre").evaluate((pre) => ({
        hidden: pre.scrollWidth - pre.clientWidth,
        whiteSpace: globalThis.getComputedStyle(pre).whiteSpace,
      }));
      expect(code.whiteSpace).toBe("pre-wrap");
      expect(code.hidden).toBeLessThanOrEqual(1);
      // ...so neither answer area, the detail pane, nor the page is wider than it should be.
      for (const region of [
        instructors,
        detail.getByRole("region", { name: "Students' answer" }),
      ]) {
        const box = await region.boundingBox();
        const pane = await detail.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
      }
      expect(
        await detail.evaluate((pane) => pane.scrollWidth - pane.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await page
          .locator("html")
          .evaluate((html) => html.scrollWidth - html.clientWidth),
      ).toBeLessThanOrEqual(0);
      await instructors.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(screenshots, `${size}-long-code.png`),
      });
    });
  });
}
