import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/post-delete");
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

const post = {
  id: "p1",
  courseId: "course-1",
  type: "question",
  deleted: false,
  title: "Question for moderation",
  bodyMarkdown: "Can we discuss this?",
  author: {
    userId: "student-author",
    displayName: "Course student",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  createdAt: "2026-10-19T00:00:00Z",
  lastActivityAt: "2026-10-19T00:00:00Z",
  version: 2,
};
async function mockApi(
  page,
  {
    role = "ta",
    failure = false,
    staleOnce = false,
    reads = [],
    postData = post,
    denyRead = false,
    feedGate,
  } = {},
) {
  let deleted = false;
  let savedPost = postData;
  const deletes = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path.endsWith("/members/u1"))
      return route.fulfill({ json: { data: { role } } });
    if (path === "/api/v1/posts/p1" && method === "DELETE") {
      deletes.push(request.headers());
      if (failure)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "canonical_has_duplicates",
              message: "Unmerge linked posts first",
            },
          },
        });
      if (staleOnce && deletes.length === 1) {
        savedPost = { ...post, version: 3 };
        return route.fulfill({
          status: 412,
          json: {
            error: { code: "version_conflict", message: "Post changed" },
          },
        });
      }
      deleted = true;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/v1/posts/p1") {
      if (denyRead)
        return route.fulfill({
          status: 403,
          json: { error: { code: "forbidden", message: "Not allowed" } },
        });
      reads.push(savedPost.version);
      return route.fulfill({ json: { data: savedPost } });
    }
    if (path.endsWith("/posts") && method === "GET") {
      const rows = deleted || denyRead ? [] : [savedPost];
      if (feedGate) await feedGate;
      return route.fulfill({
        json: {
          data: rows,
          page: { nextCursor: null, hasMore: false },
        },
      });
    }
    if (path.endsWith("/answers")) return route.fulfill({ json: { data: [] } });
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({ json: { data: [] } });
  });
  return deletes;
}
const shot = (page, name) =>
  page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });

for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport });
    test("a TA can cancel or confirm deletion of a student-owned post", async ({
      page,
    }) => {
      const deletes = await mockApi(page);
      await page.goto(`${origin}/attachments-fixture.html`);
      const action = page.getByRole("button", { name: "Delete post" });
      await expect(action).toBeVisible();
      await shot(page, `${size}-staff-control`);
      page.once("dialog", (dialog) => dialog.dismiss());
      await action.click();
      expect(deletes).toHaveLength(0);
      await expect(
        page.getByRole("heading", { name: post.title }),
      ).toBeVisible();
      await shot(page, `${size}-cancelled`);
      page.once("dialog", (dialog) => dialog.accept());
      await action.click();
      await expect(page.getByText("No posts yet.")).toBeVisible();
      expect(deletes).toHaveLength(1);
      expect(deletes[0]["if-match"]).toBe('"v2"');
      expect(deletes[0]["x-csrf-token"]).toBe("fixture-csrf");
      await shot(page, `${size}-deleted`);
    });
    test("an instructor can delete a student-owned post", async ({ page }) => {
      const deletes = await mockApi(page, { role: "instructor" });
      await page.goto(`${origin}/attachments-fixture.html`);
      await expect(
        page
          .getByRole("region", { name: "Post detail" })
          .getByText("Course student"),
      ).toBeVisible();
      const action = page.getByRole("button", { name: "Delete post" });
      await expect(action).toBeVisible();
      await shot(page, `${size}-instructor-student-post`);
      page.once("dialog", (dialog) => dialog.accept());
      await action.click();
      await expect(page.getByText("No posts yet.")).toBeVisible();
      expect(deletes).toHaveLength(1);
      expect(deletes[0]["if-match"]).toBe('"v2"');
      expect(deletes[0]["x-csrf-token"]).toBe("fixture-csrf");
    });
    test("a failed deletion keeps the post and unsaved editor text", async ({
      page,
    }) => {
      const deletes = await mockApi(page, { failure: true });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page.getByRole("button", { name: "Edit post" }).click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("My unsaved draft");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete post" }).click();
      await expect(page.getByText("Unmerge linked posts first")).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("My unsaved draft");
      expect(deletes).toHaveLength(1);
      await shot(page, `${size}-conflict-keeps-draft`);
    });
    test("a stale delete refreshes the version and requires confirmation to retry", async ({
      page,
    }) => {
      const reads = [];
      const deletes = await mockApi(page, { staleOnce: true, reads });
      let confirmations = 0;
      page.on("dialog", async (dialog) => {
        confirmations++;
        await dialog.accept();
      });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page.getByRole("button", { name: "Edit post" }).click();
      const title = page.getByRole("textbox", { name: "Post title" });
      await title.fill("My unsaved draft");
      const action = page.getByRole("button", { name: "Delete post" });
      await action.click();
      await expect(page.getByText("Post changed")).toBeVisible();
      await expect(title).toHaveValue("My unsaved draft");
      await expect.poll(() => reads).toEqual([2, 3]);
      expect(confirmations).toBe(1);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]["if-match"]).toBe('"v2"');
      await shot(page, `${size}-stale-delete-keeps-draft`);
      await action.click();
      await expect(page.getByText("No posts yet.")).toBeVisible();
      expect(confirmations).toBe(2);
      expect(deletes).toHaveLength(2);
      expect(deletes[1]["if-match"]).toBe('"v3"');
      await shot(page, `${size}-stale-delete-retried`);
    });
    test("another student cannot see a deletion control", async ({ page }) => {
      await mockApi(page, { role: "student" });
      await page.goto(`${origin}/attachments-fixture.html`);
      await expect(
        page.getByRole("heading", { name: post.title }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toHaveCount(0);
      await shot(page, `${size}-other-student`);
    });
    test("a student cannot delete a staff-owned post", async ({ page }) => {
      const deletes = await mockApi(page, {
        role: "student",
        postData: {
          ...post,
          author: {
            ...post.author,
            userId: "staff-author",
            displayName: "Course TA",
          },
        },
      });
      await page.goto(`${origin}/attachments-fixture.html`);
      await expect(
        page
          .getByRole("region", { name: "Post detail" })
          .getByText("Course TA"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toHaveCount(0);
      expect(deletes).toHaveLength(0);
      await shot(page, `${size}-student-cannot-delete-staff-post`);
    });
    test("the author sees Delete post, but an archived course does not", async ({
      page,
    }) => {
      await mockApi(page, {
        role: "student",
        postData: { ...post, author: { ...post.author, userId: "u1" } },
      });
      await page.goto(`${origin}/attachments-fixture.html`);
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toBeVisible();
      await shot(page, `${size}-author-control`);
      await page.goto(`${origin}/attachments-fixture.html?status=archived`);
      await expect(
        page.getByRole("heading", { name: post.title }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toHaveCount(0);
      await shot(page, `${size}-archived-no-delete`);
    });
    test("a confirmed merged source and an unreadable private post have no blind-delete control", async ({
      page,
    }) => {
      await mockApi(page, {
        postData: { ...post, duplicateStatus: "confirmed" },
      });
      await page.goto(`${origin}/attachments-fixture.html`);
      await expect(
        page.getByRole("heading", { name: post.title }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toHaveCount(0);
      await shot(page, `${size}-merged-no-delete`);

      await page.unrouteAll();
      const deletes = await mockApi(page, { denyRead: true });
      await page.reload();
      await expect(page.getByRole("alert", { name: "" })).toHaveText(
        "This post is unavailable.",
      );
      await expect(
        page.getByRole("button", { name: "Delete post" }),
      ).toHaveCount(0);
      expect(deletes).toHaveLength(0);
      await shot(page, `${size}-unreadable-no-delete`);
    });
    test("a stale in-flight feed cannot restore a successfully deleted post", async ({
      page,
    }) => {
      let releaseFeed;
      const feedGate = new Promise((resolve) => {
        releaseFeed = resolve;
      });
      const deletes = await mockApi(page, { feedGate });
      await page.goto(`${origin}/attachments-fixture.html`);
      const action = page.getByRole("button", { name: "Delete post" });
      await expect(action).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await action.click();
      await expect.poll(() => deletes.length).toBe(1);
      const staleResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith("/posts") &&
          response.request().method() === "GET",
      );
      releaseFeed();
      await staleResponse;
      expect(deletes).toHaveLength(1);
      await expect(page.getByText("No posts yet.")).toBeVisible();
      await expect(page.getByRole("link", { name: post.title })).toHaveCount(0);
      await shot(page, `${size}-stale-feed-does-not-restore`);
    });
  });
}
