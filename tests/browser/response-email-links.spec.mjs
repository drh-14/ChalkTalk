import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/response-email-links");
mkdirSync(screenshots, { recursive: true });
const now = "2026-10-23T00:00:00Z";
const author = { id: "author", displayName: "Course member" };
const answer = {
  id: "answer-1",
  postId: "fixture-post",
  kind: "student",
  deleted: false,
  bodyMarkdown: "The answer is here.",
  contributors: [author],
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
const followup = (id, parentId, bodyMarkdown, replyCount = 0) => ({
  id,
  postId: "fixture-post",
  parentId,
  author,
  anonymous: false,
  bodyMarkdown,
  deleted: false,
  createdAt: now,
  updatedAt: now,
  version: 1,
  canEdit: false,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount,
});
const rootReply = followup("root-1", null, "Root discussion", 1);
const parentReply = followup("reply-1", "root-1", "Parent reply", 1);
const targetReply = followup("reply-2", "reply-1", "Exact nested reply");
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

async function open(browser, hash, roots = []) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const fulfill = (data, meta) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(meta ? { data, meta } : { data }),
      });
    if (path === "/api/v1/posts/fixture-post/answers") return fulfill([answer]);
    if (path === "/api/v1/posts/fixture-post/followups")
      return fulfill(roots, {
        total: roots.length || 1,
        nextCursor: roots.length ? null : "more",
      });
    const id = path.match(/^\/api\/v1\/followups\/([^/]+)$/)?.[1];
    if (id) {
      const item = [rootReply, parentReply, targetReply].find(
        (entry) => entry.id === id,
      );
      if (item) return fulfill(item);
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found" } }),
    });
  });
  await page.goto(`${origin}/answer-save-fixture.html#${hash}`);
  return { context, page };
}

test("answer email link opens and focuses the exact answer", async ({
  browser,
}) => {
  const { context, page } = await open(browser, "answer-answer-1");
  const target = page.locator("#answer-answer-1");
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "answer-link.png"),
    fullPage: true,
  });
  await context.close();
});

test("root followup email link opens and focuses the discussion", async ({
  browser,
}) => {
  const { context, page } = await open(browser, "followup-root-1", [rootReply]);
  const target = page.locator("#followup-root-1");
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "root-followup-link.png"),
    fullPage: true,
  });
  await context.close();
});

test("off-page nested reply email link reveals ancestors and focuses the reply", async ({
  browser,
}) => {
  const { context, page } = await open(browser, "followup-reply-2");
  await expect(page.locator("#followup-root-1")).toBeVisible();
  await expect(page.locator("#followup-reply-1")).toBeVisible();
  const target = page.locator("#followup-reply-2");
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  await expect(target).toContainText("Exact nested reply");
  await page.screenshot({
    path: resolve(screenshots, "nested-reply-link.png"),
    fullPage: true,
  });
  await context.close();
});

test("deep-linked reply keeps sibling pagination available at each ancestor", async ({
  browser,
}) => {
  const { context, page } = await open(browser, "followup-reply-2");
  await expect(page.locator("#followup-reply-2")).toBeFocused();
  const rootSibling = followup("root-sibling", "root-1", "Root sibling");
  const childSibling = followup("child-sibling", "reply-1", "Child sibling");
  const laterRootSibling = followup("later-root-sibling", "root-1", "Later root sibling");
  const laterChildSibling = followup("later-child-sibling", "reply-1", "Later child sibling");
  await page.route("**/api/v1/followups/*/replies*", async (route) => {
    const url = new URL(route.request().url());
    const root = url.pathname.includes("root-1");
    const later = url.searchParams.has("cursor");
    const child = root
      ? later ? laterRootSibling : rootSibling
      : later ? laterChildSibling : childSibling;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [child], meta: { total: 3, nextCursor: later ? null : "next" } }),
    });
  });
  await page.locator("#followup-root-1").getByRole("button", { name: /Show .* replies/ }).first().click();
  await expect(page.getByText("Root sibling")).toBeVisible();
  await page.locator("#followup-root-1").getByRole("button", { name: "Load more replies" }).first().click();
  await expect(page.getByText("Later root sibling")).toBeVisible();
  await page.locator("#followup-reply-1").getByRole("button", { name: /Show .* replies/ }).click();
  await expect(page.getByText("Child sibling")).toBeVisible();
  await page.locator("#followup-reply-1").getByRole("button", { name: "Load more replies" }).click();
  await expect(page.getByText("Later child sibling")).toBeVisible();
  await expect(page.locator("#followup-reply-2")).toHaveCount(1);
  await page.screenshot({
    path: resolve(screenshots, "nested-reply-siblings.png"),
    fullPage: true,
  });
  await context.close();
});

test("unavailable response link leaves the discussion usable without exposing content", async ({
  browser,
}) => {
  const { context, page } = await open(browser, "followup-missing");
  await expect(page.getByRole("region", { name: "Answers" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Followup discussions" }),
  ).toBeVisible();
  await expect(page.locator("#followup-missing")).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "unavailable-response-link.png"),
    fullPage: true,
  });
  await context.close();
});
