import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/revision-history");
const now = "2026-10-21T00:00:00Z";
const author = { id: "member-1", displayName: "Browser member" };
const labels = {
  "fixture-post": "post",
  "answer-1": "answer",
  "root-1": "root followup",
  "reply-1": "reply",
};
const revision = (id, ordinal, staff) => ({
  id: `${id}-revision-${ordinal}`,
  ordinal,
  resourceVersion: ordinal,
  createdAt: now,
  title:
    id === "fixture-post"
      ? ordinal === 1
        ? "Earlier title"
        : "Current title"
      : null,
  bodyMarkdown: `${ordinal === 1 ? "Earlier" : "Current"} ${labels[id]} text`,
  baseline: ordinal === 1,
  restoredFromRevisionId: null,
  editor:
    staff && ordinal !== 1
      ? { id: "staff-1", displayName: "Course instructor" }
      : null,
});
const revisionMetadata = ({
  id,
  ordinal,
  resourceVersion,
  createdAt,
  baseline,
  restoredFromRevisionId,
  editor,
}) => ({
  id,
  ordinal,
  resourceVersion,
  createdAt,
  baseline,
  restoredFromRevisionId,
  editor,
});
const followup = (id, parentId) => ({
  id,
  postId: "fixture-post",
  parentId,
  author,
  anonymous: false,
  bodyMarkdown: `Current ${labels[id]} text`,
  attachments: [],
  deleted: false,
  createdAt: now,
  updatedAt: now,
  version: 2,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount: id === "root-1" ? 1 : 0,
  resolved: false,
  canResolve: false,
});

test.describe("revision history through production discussion views", () => {
  let vite;
  let origin;
  test.beforeAll(async () => {
    vite = await createServer({
      root: resolve(root, "apps/web"),
      server: { host: "127.0.0.1", port: 0 },
    });
    await vite.listen();
    origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
    await mkdir(screenshots, { recursive: true });
  });
  test.afterAll(async () => {
    await vite?.close();
  });

  async function open(
    browser,
    {
      staff = false,
      conflict = false,
      state = "",
      singleRevision = false,
    } = {},
  ) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const resources = {
      "fixture-post": {
        id: "fixture-post",
        courseId: "fixture-course",
        type: "question",
        deleted: false,
        title: "Current title",
        bodyMarkdown: "Current post text",
        author: {
          userId: "member-1",
          displayName: "Browser member",
          anonymous: false,
          deleted: false,
        },
        anonymous: false,
        tags: [],
        attachments: [],
        createdAt: now,
        lastActivityAt: now,
        version: 2,
        duplicateStatus: "none",
        duplicateOfPostId: null,
        pinned: false,
        private: false,
        following: false,
      },
      "answer-1": {
        id: "answer-1",
        postId: "fixture-post",
        kind: "student",
        deleted: false,
        bodyMarkdown: "Current answer text",
        contributors: [author],
        anonymous: false,
        attachments: [],
        endorsedAt: null,
        endorsedBy: null,
        createdAt: now,
        updatedAt: now,
        version: 2,
        canEdit: true,
        upvoteCount: 0,
        viewerUpvoted: false,
      },
      "root-1": followup("root-1", null),
      "reply-1": followup("reply-1", "root-1"),
    };
    if (singleRevision)
      for (const [id, resource] of Object.entries(resources)) {
        const first = revision(id, 1, staff);
        resource.bodyMarkdown = first.bodyMarkdown;
        resource.version = 1;
        if (id === "fixture-post") resource.title = first.title;
      }
    const histories = Object.fromEntries(
      Object.keys(resources).map((id) => [
        id,
        singleRevision
          ? [revision(id, 1, staff)]
          : [revision(id, 1, staff), revision(id, 2, staff)],
      ]),
    );
    const restoreRequests = [];
    const compareRequests = [];
    let conflictSent = false;
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const fulfill = (payload, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(payload),
        });
      const history = path.match(
        /^\/api\/v1\/(posts|answers|followups)\/([^/]+)\/revisions(?:\/([^/]+))?(?:\/(restore))?$/,
      );
      if (history) {
        const [, , id, segment, restore] = history;
        const versions = histories[id];
        if (restore && method === "POST") {
          restoreRequests.push({ id, etag: request.headers()["if-match"] });
          if (conflict && id === "reply-1" && !conflictSent) {
            conflictSent = true;
            resources[id].version++;
            resources[id].bodyMarkdown = "Concurrent reply text";
            return fulfill(
              {
                error: {
                  code: "version_conflict",
                  message: "Content changed",
                },
              },
              412,
            );
          }
          const chosen = versions.find((entry) => entry.id === segment);
          const current = resources[id];
          current.bodyMarkdown = chosen.bodyMarkdown;
          if (id === "fixture-post") current.title = chosen.title;
          current.version++;
          versions.push({
            ...chosen,
            id: `${id}-revision-${versions.length + 1}`,
            ordinal: versions.length + 1,
            resourceVersion: current.version,
            baseline: false,
            editor: { id: "staff-1", displayName: "Course instructor" },
            restoredFromRevisionId: chosen.id,
          });
          return fulfill({ data: current });
        }
        if (segment === "compare") {
          compareRequests.push({
            id,
            left: url.searchParams.get("left"),
            right: url.searchParams.get("right"),
          });
          const left = versions.find(
            (entry) => entry.id === url.searchParams.get("left"),
          );
          const right = versions.find(
            (entry) => entry.id === url.searchParams.get("right"),
          );
          return fulfill({ data: { left, right } });
        }
        return segment
          ? fulfill({ data: versions.find((entry) => entry.id === segment) })
          : fulfill({
              data: versions.map(revisionMetadata),
              page: { nextCursor: null },
            });
      }
      if (path === "/api/v1/courses/fixture-course/members/viewer")
        return fulfill({ data: { role: staff ? "ta" : "student" } });
      if (path === "/api/v1/courses/fixture-course/posts")
        return fulfill({
          data: [resources["fixture-post"]],
          page: { nextCursor: null, hasMore: false },
        });
      if (path === "/api/v1/posts/fixture-post")
        return state === "hidden"
          ? fulfill({ error: { code: "not_found", message: "Not found" } }, 404)
          : fulfill({ data: resources["fixture-post"] });
      if (path === "/api/v1/posts/fixture-post/answers")
        return fulfill({ data: [resources["answer-1"]] });
      if (path === "/api/v1/posts/fixture-post/followups")
        return fulfill({
          data: [resources["root-1"]],
          meta: { total: 1, nextCursor: null },
        });
      if (path === "/api/v1/followups/root-1/replies")
        return fulfill({
          data: [resources["reply-1"]],
          meta: { total: 1, nextCursor: null },
        });
      const resource = path.match(
        /^\/api\/v1\/(posts|answers|followups)\/([^/]+)$/,
      );
      if (resource && method === "GET" && resources[resource[2]])
        return fulfill({ data: resources[resource[2]] });
      return fulfill({ data: [], page: { nextCursor: null, hasMore: false } });
    });
    page.on("dialog", (dialog) => void dialog.accept());
    const params = new URLSearchParams();
    if (staff) params.set("staff", "1");
    if (state) params.set(state, "1");
    await page.goto(`${origin}/history-fixture.html?${params}`);
    if (state === "hidden")
      await expect(page.getByText("This post is unavailable.")).toBeVisible();
    else
      await expect(
        page.locator(".discussion-detail").getByRole("heading", {
          name: singleRevision ? "Earlier title" : "Current title",
        }),
      ).toBeVisible();
    return { page, context, resources, restoreRequests, compareRequests };
  }

  test("member compares post, answer, root, and reply history without staff controls", async ({
    browser,
  }) => {
    const { page, context } = await open(browser);
    await page.getByRole("button", { name: "Show 1 replies" }).click();
    const surfaces = [
      [
        "fixture-post",
        page.locator('.revision-history[aria-label="post history"]'),
        "post",
      ],
      [
        "answer-1",
        page.locator('.revision-history[aria-label="answer history"]'),
        "answer",
      ],
      [
        "root-1",
        page
          .locator("article.followup-item")
          .first()
          .locator(".revision-history")
          .first(),
        "followup",
      ],
      [
        "reply-1",
        page
          .locator("article.followup-item")
          .last()
          .locator(".revision-history"),
        "reply",
      ],
    ];
    for (const [id, card, file] of surfaces) {
      await card.getByRole("button", { name: "History", exact: true }).click();
      await card.getByRole("button", { name: "Compare versions" }).click();
      await expect(
        card
          .locator(".revision-compare")
          .getByText(`Earlier ${labels[id]} text`),
      ).toBeVisible();
      await expect(
        card
          .locator(".revision-compare")
          .getByText(`Current ${labels[id]} text`),
      ).toBeVisible();
      await expect(card.getByText(/Editor:/)).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: /Restore version/ }),
      ).toHaveCount(0);
      await page.screenshot({
        path: resolve(screenshots, `member-${file}-compare.png`),
        fullPage: true,
      });
    }
    await context.close();
  });

  test("reversed comparison selections keep chronological headings", async ({
    browser,
  }) => {
    const { page, context, compareRequests } = await open(browser);
    const card = page.locator('.revision-history[aria-label="post history"]');
    await card.getByRole("button", { name: "History", exact: true }).click();
    await card.getByLabel("Version A").selectOption("fixture-post-revision-2");
    await card.getByLabel("Version B").selectOption("fixture-post-revision-1");
    await card.getByRole("button", { name: "Compare versions" }).click();
    const columns = card.locator(".revision-compare > section");
    await expect(columns.nth(0)).toContainText("Earlier text");
    await expect(columns.nth(0)).toContainText("Earlier post text");
    await expect(columns.nth(1)).toContainText("Later text");
    await expect(columns.nth(1)).toContainText("Current post text");
    expect(compareRequests).toEqual([
      {
        id: "fixture-post",
        left: "fixture-post-revision-2",
        right: "fixture-post-revision-1",
      },
    ]);
    await page.screenshot({
      path: resolve(screenshots, "member-post-reversed-compare.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("a sole version reveals saved post, answer, root, and reply text", async ({
    browser,
  }) => {
    const { page, context } = await open(browser, { singleRevision: true });
    await page.getByRole("button", { name: "Show 1 replies" }).click();
    const surfaces = [
      [
        page.locator('.revision-history[aria-label="post history"]'),
        "Earlier post text",
      ],
      [
        page.locator('.revision-history[aria-label="answer history"]'),
        "Earlier answer text",
      ],
      [
        page
          .locator("article.followup-item")
          .first()
          .locator(".revision-history")
          .first(),
        "Earlier root followup text",
      ],
      [
        page
          .locator("article.followup-item")
          .last()
          .locator(".revision-history"),
        "Earlier reply text",
      ],
    ];
    for (const [card, body] of surfaces) {
      await card.getByRole("button", { name: "History", exact: true }).click();
      await card.getByText("View version 1 text").click();
      await expect(card.locator("details[open] pre")).toHaveText(body);
      await expect(
        card.getByRole("button", { name: "Compare versions" }),
      ).toHaveCount(0);
    }
    await expect(surfaces[0][0].locator("details[open]")).toContainText(
      "Title: Earlier title",
    );
    await page.screenshot({
      path: resolve(screenshots, "member-single-version-text.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("staff restores post text through the detail view", async ({
    browser,
  }) => {
    const { page, context, restoreRequests } = await open(browser, {
      staff: true,
    });
    const card = page.locator('.revision-history[aria-label="post history"]');
    await card.getByRole("button", { name: "History", exact: true }).click();
    await expect(card.getByText(/Editor: Course instructor/)).toBeVisible();
    await card.getByRole("button", { name: "Restore version 1" }).click();
    await expect(
      page.locator(".discussion-detail").getByRole("heading", {
        name: "Earlier title",
      }),
    ).toBeVisible();
    expect(restoreRequests).toEqual([{ id: "fixture-post", etag: '"v2"' }]);
    await page.screenshot({
      path: resolve(screenshots, "staff-post-restore.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("staff restores answer and root followup through their cards", async ({
    browser,
  }) => {
    const { page, context, restoreRequests } = await open(browser, {
      staff: true,
    });
    const answer = page.getByRole("region", {
      name: "Answer by Browser member",
    });
    const answerHistory = answer.locator(".revision-history");
    await answerHistory.getByRole("button", { name: "History" }).click();
    await answerHistory
      .getByRole("button", { name: "Restore version 1" })
      .click();
    await expect(answer.locator(".response-text")).toContainText(
      "Earlier answer text",
    );
    await page.screenshot({
      path: resolve(screenshots, "staff-answer-restore.png"),
      fullPage: true,
    });

    const root = page.locator("article.followup-item").first();
    const rootHistory = root.locator(".revision-history").first();
    await rootHistory.getByRole("button", { name: "History" }).click();
    await rootHistory
      .getByRole("button", { name: "Restore version 1" })
      .click();
    await expect(root.locator(".response-text").first()).toContainText(
      "Earlier root followup text",
    );
    expect(restoreRequests).toEqual([
      { id: "answer-1", etag: '"v2"' },
      { id: "root-1", etag: '"v2"' },
    ]);
    await page.screenshot({
      path: resolve(screenshots, "staff-followup-restore.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("staff refreshes and restores a reply after a stale version", async ({
    browser,
  }) => {
    const { page, context, restoreRequests } = await open(browser, {
      staff: true,
      conflict: true,
    });
    await page.getByRole("button", { name: "Show 1 replies" }).click();
    await expect(page.locator("article.followup-item")).toHaveCount(2);
    const reply = page.locator("article.followup-item").last();
    const card = reply.locator(".revision-history");
    await card.getByRole("button", { name: "History", exact: true }).click();
    await card.getByRole("button", { name: "Restore version 1" }).click();
    await expect(card.getByRole("alert")).toContainText("changed");
    await page.screenshot({
      path: resolve(screenshots, "staff-reply-stale-restore.png"),
      fullPage: true,
    });
    await card.getByRole("button", { name: "Refresh current version" }).click();
    await card.getByRole("button", { name: "Restore version 1" }).click();
    await expect(
      reply.locator(".response-text").getByText("Earlier reply text"),
    ).toBeVisible();
    expect(restoreRequests).toEqual([
      { id: "reply-1", etag: '"v2"' },
      { id: "reply-1", etag: '"v3"' },
    ]);
    await page.screenshot({
      path: resolve(screenshots, "staff-reply-restored.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("archived discussion exposes history but no restore actions", async ({
    browser,
  }) => {
    const { page, context } = await open(browser, {
      staff: true,
      state: "archived",
    });
    const card = page.locator('.revision-history[aria-label="post history"]');
    await card.getByRole("button", { name: "History", exact: true }).click();
    await expect(card.locator("ol strong").first()).toHaveText("Version 1");
    await expect(
      card.getByRole("button", { name: /Restore version/ }),
    ).toHaveCount(0);
    await page.screenshot({
      path: resolve(screenshots, "staff-archived-history.png"),
      fullPage: true,
    });
    await context.close();
  });

  test("hidden post detail offers no history controls", async ({ browser }) => {
    const { page, context } = await open(browser, { state: "hidden" });
    await expect(page.getByRole("button", { name: "History" })).toHaveCount(0);
    await page.screenshot({
      path: resolve(screenshots, "member-hidden-content.png"),
      fullPage: true,
    });
    await context.close();
  });
});
