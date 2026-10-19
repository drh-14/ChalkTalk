import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/answer-save-only");
const now = "2026-10-18T00:00:00Z";
const author = { id: "member-1", displayName: "Browser student" };

test.describe("save-only answers and REST followups", () => {
  let vite;
  let origin;
  let answer;
  let followups;
  let replies;
  const patches = [];
  const unexpectedTickets = [];
  const unexpectedSockets = [];

  const asAnswer = (bodyMarkdown, version = 1) => ({
    id: "answer-1",
    postId: "fixture-post",
    kind: "student",
    deleted: false,
    bodyMarkdown,
    contributors: [author],
    anonymous: false,
    attachments: [],
    endorsedAt: null,
    endorsedBy: null,
    createdAt: now,
    updatedAt: now,
    version,
    canEdit: true,
    upvoteCount: 0,
    viewerUpvoted: false,
  });
  const asFollowup = (id, parentId, bodyMarkdown, version = 1) => ({
    id,
    postId: "fixture-post",
    parentId,
    author,
    anonymous: false,
    bodyMarkdown,
    deleted: false,
    createdAt: now,
    updatedAt: now,
    version,
    canEdit: true,
    upvoteCount: 0,
    viewerUpvoted: false,
    replyCount: 0,
  });

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
  test.beforeEach(() => {
    answer = asAnswer("Saved **Markdown** and $x^2$");
    followups = [];
    replies = [];
    patches.length = 0;
    unexpectedTickets.length = 0;
    unexpectedSockets.length = 0;
  });

  async function openEditor(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("websocket", (socket) => {
      const url = new URL(socket.url());
      // Vite's development-only HMR connection is not application collaboration.
      if (url.pathname !== "/" || !url.searchParams.has("token"))
        unexpectedSockets.push(socket.url());
    });
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      const body = request.postDataJSON?.() ?? {};
      const fulfill = (data, status = 200, meta) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(meta ? { data, meta } : { data }),
        });
      if (path.endsWith("/collaboration-ticket")) {
        unexpectedTickets.push(path);
        return route.fulfill({ status: 404, body: "{}" });
      }
      if (path === "/api/v1/posts/fixture-post/answers") {
        if (method === "POST") {
          answer = asAnswer(body.bodyMarkdown);
          return fulfill(answer, 201);
        }
        return fulfill(answer ? [answer] : []);
      }
      if (path === "/api/v1/answers/answer-1") {
        if (method === "GET") return fulfill(answer);
        if (method === "PATCH") {
          patches.push({
            body: body.bodyMarkdown,
            etag: request.headers()["if-match"],
          });
          if (request.headers()["if-match"] !== `"v${answer.version}"`)
            return route.fulfill({
              status: 412,
              contentType: "application/json",
              body: JSON.stringify({
                error: { code: "version_conflict", message: "Answer changed" },
              }),
            });
          answer = asAnswer(body.bodyMarkdown, answer.version + 1);
          return fulfill(answer);
        }
      }
      if (path === "/api/v1/posts/fixture-post/followups") {
        if (method === "POST") {
          const created = asFollowup("followup-1", null, body.bodyMarkdown);
          followups.push(created);
          return fulfill(created, 201);
        }
        return fulfill(followups, 200, {
          total: followups.length,
          nextCursor: null,
        });
      }
      if (path === "/api/v1/followups/followup-1/replies") {
        if (method === "POST") {
          const created = asFollowup(
            "reply-1",
            "followup-1",
            body.bodyMarkdown,
          );
          replies.push(created);
          followups[0].replyCount = replies.length;
          return fulfill(created, 201);
        }
        return fulfill(replies, 200, {
          total: replies.length,
          nextCursor: null,
        });
      }
      if (path === "/api/v1/followups/followup-1" && method === "PATCH") {
        followups[0] = asFollowup(
          "followup-1",
          null,
          body.bodyMarkdown,
          followups[0].version + 1,
        );
        followups[0].replyCount = replies.length;
        return fulfill(followups[0]);
      }
      return route.fulfill({ status: 404, body: "{}" });
    });
    await page.goto(`${origin}/answer-save-fixture.html`);
    const student = page.getByRole("region", { name: "Students' answer" });
    if (answer)
      await expect(
        student.getByRole("button", { name: "Edit answer" }),
      ).toBeVisible();
    return { context, page, student };
  }

  test("two independent drafts do not publish until Save; conflict requires explicit Overwrite", async ({
    browser,
  }) => {
    const first = await openEditor(browser);
    const second = await openEditor(browser);
    await first.student.getByRole("button", { name: "Edit answer" }).click();
    await second.student.getByRole("button", { name: "Edit answer" }).click();
    await first.student
      .getByRole("textbox", { name: "Answer" })
      .fill("First **saved** and $a^2$");
    await second.student
      .getByRole("textbox", { name: "Answer" })
      .fill("Second **draft** and $b^2$");
    expect(patches).toHaveLength(0);
    await expect(
      second.student.getByRole("textbox", { name: "Answer" }),
    ).toContainText("Second **draft**");
    await first.student.getByRole("button", { name: "Save answer" }).click();
    await expect(first.student.locator("strong")).toContainText("saved");
    expect(patches).toEqual([
      { body: "First **saved** and $a^2$", etag: '"v1"' },
    ]);
    await first.page.screenshot({
      path: resolve(screenshots, "saved-markdown.png"),
      fullPage: true,
    });
    await second.student.getByRole("button", { name: "Save answer" }).click();
    const conflict = second.page.getByRole("region", {
      name: "Answer conflict",
    });
    await expect(conflict).toContainText("First saved and");
    await expect(conflict).toContainText("Second draft and");
    await expect(
      second.student.getByRole("textbox", { name: "Answer" }),
    ).toContainText("Second **draft**");
    expect(answer.bodyMarkdown).toBe("First **saved** and $a^2$");
    await second.page.screenshot({
      path: resolve(screenshots, "answer-conflict.png"),
      fullPage: true,
    });
    // A third writer can win after the conflict is displayed but before Overwrite.
    answer = asAnswer("Third **saved** and $c^2$", 3);
    await conflict
      .getByRole("button", { name: "Overwrite with my draft" })
      .click();
    await expect(conflict).toContainText("Third saved and");
    await expect(
      second.student.getByRole("textbox", { name: "Answer" }),
    ).toContainText("Second **draft**");
    expect(patches.at(-1)).toEqual({
      body: "Second **draft** and $b^2$",
      etag: '"v2"',
    });
    await second.page.screenshot({
      path: resolve(screenshots, "answer-second-conflict.png"),
      fullPage: true,
    });
    await conflict
      .getByRole("button", { name: "Overwrite with my draft" })
      .click();
    await expect(conflict).toHaveCount(0);
    await expect(second.student.locator("strong")).toContainText("draft");
    await expect(second.student.locator(".katex")).toBeVisible();
    expect(patches.at(-1)).toEqual({
      body: "Second **draft** and $b^2$",
      etag: '"v3"',
    });
    expect(unexpectedTickets).toEqual([]);
    expect(unexpectedSockets).toEqual([]);
    await second.page.screenshot({
      path: resolve(screenshots, "answer-overwrite.png"),
      fullPage: true,
    });
    await first.context.close();
    await second.context.close();
  });

  test("historical empty answer remains visible and editable", async ({
    browser,
  }) => {
    answer = asAnswer("");
    const { context, page, student } = await openEditor(browser);
    await expect(student.getByText("This answer is empty.")).toBeVisible();
    await expect(
      student.getByRole("button", { name: "Edit answer" }),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(screenshots, "historical-empty-answer.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("created answer, followup and reply render Markdown and LaTeX; followup edits stay REST-only", async ({
    browser,
  }) => {
    answer = null;
    const { context, page, student } = await openEditor(browser);
    await student
      .getByRole("button", { name: "Start students' answer" })
      .click();
    await student
      .getByRole("textbox", { name: "Your answer" })
      .fill("Answer **bold** and $x^2$");
    await student.getByRole("button", { name: "Post answer" }).click();
    await expect(student.locator("strong")).toContainText("bold");
    await expect(student.locator(".katex")).toBeVisible();
    await page
      .getByRole("button", { name: "Compose a new followup discussion" })
      .click();
    const discussions = page.getByRole("region", {
      name: "Followup discussions",
    });
    await discussions
      .getByRole("textbox", { name: "Followup" })
      .fill("Root **bold** and $y^2$");
    await discussions.getByRole("button", { name: "Post followup" }).click();
    const rootFollowup = page
      .getByRole("article", { name: "Followup by Browser student" })
      .first();
    await expect(rootFollowup.locator("strong")).toContainText("bold");
    await expect(rootFollowup.locator(".katex")).toBeVisible();
    await rootFollowup.getByRole("button", { name: "Edit followup" }).click();
    await rootFollowup
      .getByRole("textbox", { name: "Followup" })
      .fill("Edited **root** and $z^2$");
    await rootFollowup.getByRole("button", { name: "Save followup" }).click();
    await expect(rootFollowup.locator("strong")).toContainText("root");
    await rootFollowup.getByRole("button", { name: "Reply" }).click();
    await rootFollowup
      .getByRole("textbox", { name: "Followup" })
      .fill("Reply **bold** and $w^2$");
    await rootFollowup.getByRole("button", { name: "Post reply" }).click();
    const reply = rootFollowup.getByRole("article", {
      name: "Followup by Browser student",
    });
    await expect(reply.locator("strong")).toContainText("bold");
    await expect(reply.locator(".katex")).toBeVisible();
    expect(unexpectedTickets).toEqual([]);
    expect(unexpectedSockets).toEqual([]);
    await page.screenshot({
      path: resolve(screenshots, "rendered-responses.png"),
      fullPage: true,
    });
    await context.close();
  });
});
