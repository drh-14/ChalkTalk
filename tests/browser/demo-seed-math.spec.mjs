import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let vite;
let origin;
let bodies;
test.beforeAll(async () => {
  test.skip(
    !process.env.TEST_DATABASE_URL,
    "Requires PostgreSQL to generate actual seed bodies in an isolated schema",
  );
  bodies = JSON.parse(
    execFileSync(
      process.execPath,
      ["--import", "tsx", "tests/browser/fixtures/seed-math-data.ts"],
      { cwd: root, encoding: "utf8" },
    ),
  );
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

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 1080 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport });
    for (const variant of ["fresh", "repaired"]) {
      test(`renders actual ${variant} seeded question and answer math`, async ({
        page,
      }) => {
        const now = new Date().toISOString();
        const post = {
          id: "p1",
          courseId: "course-1",
          type: "question",
          deleted: false,
          title: "How do I parametrize an arc length problem?",
          bodyMarkdown: bodies[variant].question,
          author: {
            userId: "u1",
            displayName: "Taylor Brooks",
            anonymous: false,
            deleted: false,
          },
          anonymous: false,
          tags: ["arc-length"],
          attachments: [],
          createdAt: now,
          lastActivityAt: now,
          version: 1,
        };
        const answer = {
          id: "a1",
          postId: "p1",
          kind: "student",
          deleted: false,
          bodyMarkdown: bodies[variant].answer,
          contributors: [{ id: "u1", displayName: "Alex Rivera" }],
          anonymous: false,
          attachments: [],
          endorsedAt: null,
          endorsedBy: null,
          createdAt: now,
          updatedAt: now,
          version: 1,
          canEdit: true,
          upvoteCount: 0,
          viewerUpvoted: false,
        };
        await page.route("**/api/v1/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith("/members/u1"))
            return route.fulfill({ json: { data: { role: "student" } } });
          if (path.endsWith("/posts"))
            return route.fulfill({
              json: {
                data: [post],
                page: { hasMore: false, nextCursor: null },
              },
            });
          if (path.endsWith("/posts/p1"))
            return route.fulfill({ json: { data: post } });
          if (path.endsWith("/answers"))
            return route.fulfill({ json: { data: [answer] } });
          if (path.endsWith("/followups"))
            return route.fulfill({
              json: { data: [], meta: { nextCursor: null, total: 0 } },
            });
          if (path.endsWith("/tags"))
            return route.fulfill({ json: { data: [{ name: "arc-length" }] } });
          return route.fulfill({
            status: 404,
            json: {
              error: { code: "not_found", message: "Fixture route missing" },
            },
          });
        });
        await page.goto(`${origin}/attachments-fixture.html`);
        const question = page.locator(".discussion-detail article").first();
        const answerPanel = page.locator(".shared-answer-student");
        await expect(question.locator(".katex").first()).toBeVisible();
        await expect(answerPanel.locator(".katex").first()).toBeVisible();
        await expect(page.locator(".katex-error")).toHaveCount(0);
        await expect(answerPanel).not.toContainText("sqrt(");
      });
    }
  });
}
