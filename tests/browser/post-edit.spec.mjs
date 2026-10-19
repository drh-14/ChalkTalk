import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/post-edit");
const png = readFileSync(
  resolve(root, "tests/browser/fixtures/attachment-diagram.png"),
);
const file = (id, fileName, mediaType) => ({
  id,
  fileName,
  mediaType,
  sizeBytes: 12,
  createdAt: "2026-10-19T00:00:00Z",
  downloadUrl: `/api/v1/attachments/${id}/download`,
});
const image = file("image", "diagram.png", "image/png");
const document = file("document", "notes.txt", "text/plain");
const makePost = (type = "note") => ({
  id: "p1",
  courseId: "course-1",
  type,
  deleted: false,
  title: "Reflection notes",
  bodyMarkdown: "A **boundary** condition with $x^2$.",
  author: {
    userId: "u1",
    displayName: "Ada",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: ["optics"],
  attachments: [image, document],
  createdAt: "2026-10-19T00:00:00Z",
  lastActivityAt: "2026-10-19T00:00:00Z",
  version: 1,
});
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

async function mockApi(page, options = {}) {
  let current = makePost(options.type);
  if (options.otherAuthor) current.author.userId = "another-user";
  const patches = [];
  const uploads = [];
  let creates = 0;
  let fail = options.failUpload;
  let conflict = options.conflict;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (path.endsWith("/download"))
      return route.fulfill({
        body: path.includes("image") ? png : "notes",
        contentType: path.includes("image") ? "image/png" : "text/plain",
      });
    if (path.endsWith("/members/u1"))
      return json({ role: options.role ?? "student" });
    if (path.endsWith("/posts") && method === "GET")
      return route.fulfill({
        json: { data: [current], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/posts") && method === "POST") {
      creates++;
      current = {
        ...current,
        ...request.postDataJSON(),
        id: "created-post",
        attachments: [],
      };
      return json(current, 201);
    }
    if (path === "/api/v1/posts/p1" && method === "PATCH") {
      patches.push({
        input: request.postDataJSON(),
        etag: request.headers()["if-match"],
      });
      if (conflict) {
        conflict = false;
        current = { ...current, title: "Updated remotely", version: 4 };
        return route.fulfill({
          status: 412,
          json: {
            error: {
              code: "version_conflict",
              message: "Post version has changed",
            },
          },
        });
      }
      expect(request.headers()["if-match"]).toBe(`"v${current.version}"`);
      current = {
        ...current,
        ...request.postDataJSON(),
        version: current.version + 1,
      };
      return json(current);
    }
    if (path === `/api/v1/posts/${current.id}`) return json(current);
    if (
      options.remoteOnRemove &&
      path === "/api/v1/attachments/document" &&
      method === "DELETE"
    ) {
      current = {
        ...current,
        title: "Remote edit",
        bodyMarkdown: "Remote body",
        version: current.version + 2,
        attachments: current.attachments.filter(
          (item) => item.id !== "document",
        ),
      };
      return route.fulfill({ status: 204, body: "" });
    }
    if (
      path === `/api/v1/posts/${current.id}/attachments` &&
      method === "POST"
    ) {
      uploads.push(request.headers()["idempotency-key"]);
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "storage_unavailable", message: "Retry this file" },
          },
        });
      }
      const attached = file("added", "extra.txt", "text/plain");
      current = {
        ...current,
        version: current.version + 1,
        attachments: [...current.attachments, attached],
      };
      return json(attached, 201);
    }
    if (path.endsWith("/answers")) return json([]);
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  return {
    patches,
    uploads,
    get creates() {
      return creates;
    },
  };
}
const shot = (page, name) =>
  page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });
for (const [size, viewport] of [
  ["desktop", { width: 1440, height: 1080 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport });
    test("view is read-only; authorized Edit saves and retains image/document", async ({
      page,
    }) => {
      const api = await mockApi(page, { type: "question" });
      await page.goto(`${origin}/attachments-fixture.html`);
      const post = page.locator(".discussion-detail article").first();
      await expect(
        post.getByRole("heading", { name: "Reflection notes" }),
      ).toBeVisible();
      await expect(post.locator('input[type="file"]')).toHaveCount(0);
      await expect(
        post.getByRole("img", { name: "diagram.png" }),
      ).toBeVisible();
      await expect(post.getByRole("link", { name: "notes.txt" })).toBeVisible();
      await shot(page, `${size}-view`);
      await post
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Edited question");
      await page
        .getByRole("textbox", { name: "Post body" })
        .fill("Changed **Markdown** and $y^2$.");
      await page
        .getByRole("textbox", { name: "Tags (comma-separated)" })
        .fill("optics, waves");
      await page.getByRole("checkbox", { name: "Post anonymously" }).check();
      await expect(page.getByLabel("Add files")).toBeVisible();
      await shot(page, `${size}-editing`);
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(
        post.getByRole("heading", { name: "Edited question" }),
      ).toBeVisible();
      await expect(post.locator('input[type="file"]')).toHaveCount(0);
      await expect(
        post.getByRole("img", { name: "diagram.png" }),
      ).toBeVisible();
      await expect(post.getByRole("link", { name: "notes.txt" })).toBeVisible();
      expect(api.patches).toHaveLength(1);
      expect(api.patches[0].input).toEqual({
        title: "Edited question",
        bodyMarkdown: "Changed **Markdown** and $y^2$.",
        tags: ["optics", "waves"],
        anonymous: true,
      });
      await shot(page, `${size}-saved`);
    });
    test("note Cancel and stale conflict preserve unsaved text until explicit review", async ({
      page,
    }) => {
      const api = await mockApi(page, { role: "ta", conflict: true });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Discard me");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page
        .getByRole("button", {
          name: size === "desktop" ? "Create post" : "← Back to posts",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("Discard me");
      await shot(page, `${size}-navigation-preserved`);
      await page.getByRole("button", { name: "Cancel editing" }).click();
      await expect(
        page.getByRole("heading", { name: "Reflection notes" }),
      ).toBeVisible();
      expect(api.patches).toHaveLength(0);
      await shot(page, `${size}-cancelled`);
      await page
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Local note draft");
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("Local note draft");
      await page.getByRole("button", { name: "Review latest post" }).click();
      await expect(
        page.getByRole("heading", { name: "Updated remotely" }),
      ).toBeVisible();
      await shot(page, `${size}-conflict-review`);
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(
        page.getByRole("heading", { name: "Local note draft" }),
      ).toBeVisible();
      expect(api.patches.map((patch) => patch.etag)).toEqual(['"v1"', '"v4"']);
    });
    test("edit saves text before files and retries failed file without resaving text", async ({
      page,
    }) => {
      const api = await mockApi(page, { failUpload: true });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Saved before file");
      await page.getByLabel("Add files").setInputFiles({
        name: "extra.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("extra"),
      });
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(page.getByRole("alert")).toContainText("Retry this file");
      expect(api.patches).toHaveLength(1);
      await shot(page, `${size}-failed-file`);
      await page.getByRole("button", { name: "Retry attachments" }).click();
      await expect(
        page.getByRole("heading", { name: "Saved before file" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "extra.txt" })).toBeVisible();
      expect(api.patches).toHaveLength(1);
      expect(api.uploads).toHaveLength(2);
      expect(api.uploads[0]).toBe(api.uploads[1]);
      await shot(page, `${size}-file-recovered`);
    });
    test("attachment refresh keeps local draft until explicit versioned Save", async ({
      page,
    }) => {
      const api = await mockApi(page, { role: "ta", remoteOnRemove: true });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Local draft");
      await page.getByRole("button", { name: "Remove notes.txt" }).click();
      await expect(page.getByRole("link", { name: "notes.txt" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("Local draft");
      await expect(
        page.getByRole("button", { name: "Review latest post" }),
      ).toHaveCount(0);
      expect(api.patches).toHaveLength(0);
      await shot(page, `${size}-remote-refresh-draft`);
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(
        page.getByRole("heading", { name: "Local draft" }),
      ).toBeVisible();
      expect(api.patches).toHaveLength(1);
      expect(api.patches[0].etag).toBe('"v3"');
      expect(api.patches[0].input.bodyMarkdown).toBe(
        "A **boundary** condition with $x^2$.",
      );
    });
    test("failed merge retains the post draft and queue until a successful merge", async ({
      page,
    }) => {
      await mockApi(page, { role: "ta", failUpload: true });
      const target = {
        ...makePost("question"),
        id: "canonical",
        title: "Canonical post",
      };
      let mergeAttempts = 0;
      let finishMerge;
      const pendingMerge = new Promise((resolve) => {
        finishMerge = resolve;
      });
      await page.route("**/api/v1/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.endsWith("/posts") && url.searchParams.has("q"))
          return route.fulfill({
            json: {
              data: [target],
              page: { nextCursor: null, hasMore: false },
            },
          });
        if (
          url.pathname === "/api/v1/posts/canonical" &&
          request.method() === "GET"
        )
          return route.fulfill({ json: { data: target } });
        if (
          url.pathname === "/api/v1/posts/p1" &&
          request.method() === "PATCH" &&
          request.postDataJSON()?.duplicateStatus === "confirmed"
        ) {
          mergeAttempts++;
          if (mergeAttempts === 1)
            return route.fulfill({
              status: 503,
              json: {
                error: { code: "service_unavailable", message: "Merge failed" },
              },
            });
          await pendingMerge;
          return route.fulfill({
            json: {
              data: {
                ...makePost(),
                duplicateStatus: "confirmed",
                duplicateOfPostId: "canonical",
              },
            },
          });
        }
        return route.fallback();
      });
      await page.goto(`${origin}/attachments-fixture.html`);
      await page
        .getByRole("button", { name: "Edit post", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Saved before file");
      await page.getByLabel("Add files").setInputFiles({
        name: "extra.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("draft"),
      });
      await page.getByRole("button", { name: "Save post" }).click();
      await expect(page.getByRole("alert")).toContainText("Retry this file");
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Unsaved draft");
      await page.getByRole("button", { name: "Merge as duplicate" }).click();
      await page
        .getByRole("searchbox", { name: "Find canonical post" })
        .fill("canonical");
      await page.getByRole("link", { name: "Canonical post" }).click();
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("button", { name: "Confirm merge" }).click();
      expect(mergeAttempts).toBe(0);
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Confirm merge" }).click();
      await expect(page.getByText("Merge failed")).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("Unsaved draft");
      await expect(page.getByText("extra.txt")).toBeVisible();
      await page.screenshot({
        path: resolve(screenshots, `${size}-merge-failed-draft.png`),
        fullPage: true,
      });
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Confirm merge" }).click();
      await expect(
        page.locator(".post-composer").locator("xpath=.."),
      ).toHaveAttribute("inert", "");
      await page.screenshot({
        path: resolve(screenshots, `${size}-merge-pending-draft.png`),
        fullPage: true,
      });
      finishMerge();
      await expect(
        page.getByRole("heading", { name: "Canonical post" }),
      ).toBeVisible();
      expect(mergeAttempts).toBe(2);
    });
    test("create keeps its upload controls and recovers without duplicate post", async ({
      page,
    }) => {
      const api = await mockApi(page, { failUpload: true });
      await page.goto(`${origin}/attachments-fixture.html?post=`);
      await page
        .getByRole("button", { name: "Create post", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Post type" })
        .selectOption("note");
      await page
        .getByRole("textbox", { name: "Post title" })
        .fill("Created note");
      await page
        .getByRole("textbox", { name: "Post body" })
        .fill("A new note.");
      await page.getByLabel("Add files").setInputFiles({
        name: "extra.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("extra"),
      });
      await shot(page, `${size}-create`);
      await page.getByRole("button", { name: "Publish post" }).click();
      await expect(page.getByRole("alert")).toContainText("Retry this file");
      await page.getByRole("button", { name: "Retry attachments" }).click();
      await expect(
        page.getByRole("heading", { name: "Created note" }),
      ).toBeVisible();
      expect(api.creates).toBe(1);
      expect(api.uploads).toHaveLength(2);
      await shot(page, `${size}-created`);
    });
    for (const archived of [false, true]) {
      test(
        archived
          ? "archived post is read-only"
          : "another student's post is read-only",
        async ({ page }) => {
          await mockApi(page, { otherAuthor: !archived });
          await page.goto(
            `${origin}/attachments-fixture.html${archived ? "?status=archived" : ""}`,
          );
          await expect(
            page.getByRole("heading", { name: "Reflection notes" }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Edit post", exact: true }),
          ).toHaveCount(0);
          await expect(page.locator('input[type="file"]')).toHaveCount(0);
          await expect(
            page.getByRole("link", { name: "notes.txt" }),
          ).toBeVisible();
          await shot(page, `${size}-${archived ? "archived" : "unauthorized"}`);
        },
      );
    }
  });
}
