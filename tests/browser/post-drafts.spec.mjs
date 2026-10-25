import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { Buffer } from "node:buffer";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/post-drafts");
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
const blank = {
  type: "question",
  title: "",
  bodyMarkdown: "",
  anonymous: false,
  tags: [],
};
const shot = async (page, name) => {
  await page
    .getByRole("region", { name: "Post detail" })
    .evaluate((element) => {
      element.scrollTop = 0;
    });
  return page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });
};
async function mockApi(
  page,
  {
    content = null,
    version = 0,
    conflict = false,
    failOnce = false,
    failGetOnce = false,
    failOverwriteOnce = false,
    stalePublish = false,
    staleDiscard = false,
    archived = false,
  } = {},
) {
  const state = { content, version, writes: [], publishes: [] };
  let reads = 0;
  let conflicted = false;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (data, status = 200, headers = {}) =>
      route.fulfill({ status, json: { data }, headers });
    const draft = () => ({
      courseId: "course-1",
      content: state.content,
      updatedAt: "2026-10-25T00:00:00Z",
      version: state.version,
    });
    if (path.endsWith("/members/u1")) return json({ role: "student" });
    if (path.endsWith("/posts") && method === "GET")
      return route.fulfill({
        json: { data: [], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/post-draft")) {
      if (method === "GET") {
        reads++;
        if (failGetOnce && reads === 1)
          return route.fulfill({
            status: 503,
            json: {
              error: { code: "service_unavailable", message: "Try again" },
            },
          });
        if (failGetOnce && reads === 2)
          await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
        return json(draft(), 200, { ETag: `"v${state.version}"` });
      }
      if (method === "PUT") {
        state.writes.push(request.postDataJSON());
        if (failOnce) {
          failOnce = false;
          return route.fulfill({
            status: 503,
            json: {
              error: { code: "service_unavailable", message: "Try again" },
            },
          });
        }
        if (conflict) {
          conflict = false;
          conflicted = true;
          state.content = { ...state.content, title: "Remote revision" };
          state.version++;
        }
        if (
          conflicted &&
          failOverwriteOnce &&
          request.headers()["if-match"] === `"v${state.version}"`
        ) {
          failOverwriteOnce = false;
          return route.fulfill({
            status: 503,
            json: {
              error: { code: "service_unavailable", message: "Try again" },
            },
          });
        }
        if (request.headers()["if-match"] !== `"v${state.version}"`)
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Changed elsewhere" },
            },
          });
        if (archived)
          return route.fulfill({
            status: 409,
            json: { error: { code: "course_archived", message: "Archived" } },
          });
        state.content = request.postDataJSON().content;
        state.version++;
        return json(draft(), 200, { ETag: `"v${state.version}"` });
      }
      if (method === "DELETE") {
        if (staleDiscard)
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Changed elsewhere" },
            },
          });
        if (request.headers()["if-match"] !== `"v${state.version}"`)
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Changed elsewhere" },
            },
          });
        state.content = null;
        state.version++;
        return json(draft(), 200, { ETag: `"v${state.version}"` });
      }
    }
    if (path.endsWith("/posts") && method === "POST") {
      const input = request.postDataJSON();
      state.publishes.push(input);
      if (stalePublish)
        return route.fulfill({
          status: 412,
          json: {
            error: { code: "version_conflict", message: "Changed elsewhere" },
          },
        });
      expect(input.draftVersion).toBe(state.version);
      state.content = null;
      state.version++;
      return json(
        {
          id: "published-1",
          courseId: "course-1",
          deleted: false,
          ...input,
          author: {
            userId: "u1",
            displayName: "Ada",
            anonymous: false,
            deleted: false,
          },
          attachments: [],
          createdAt: "2026-10-25T00:00:00Z",
          lastActivityAt: "2026-10-25T00:00:00Z",
          version: 1,
        },
        201,
      );
    }
    if (path === "/api/v1/posts/published-1")
      return json({
        id: "published-1",
        courseId: "course-1",
        deleted: false,
        type: "question",
        title: "Durable idea",
        bodyMarkdown: "Saved body",
        author: {
          userId: "u1",
          displayName: "Ada",
          anonymous: false,
          deleted: false,
        },
        anonymous: false,
        tags: [],
        attachments: [],
        createdAt: "2026-10-25T00:00:00Z",
        lastActivityAt: "2026-10-25T00:00:00Z",
        version: 1,
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  return state;
}

test("autosaves one draft, restores automatically, and clears it on publish", async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Durable idea");
  await page.getByRole("textbox", { name: "Post body" }).fill("Saved body");
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.content.title).toBe("Durable idea");
  await shot(page, "01-saved-draft");
  await page.getByLabel("Add files").setInputFiles({
    name: "device-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("device only"),
  });
  await expect(
    page.getByRole("list", { name: "Selected files" }),
  ).toContainText("device-only.txt");
  await page.reload();
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(
    page.getByText("Saved draft restored for this course."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Durable idea",
  );
  await expect(page.getByRole("textbox", { name: "Post body" })).toContainText(
    "Saved body",
  );
  await expect(page.getByRole("list", { name: "Selected files" })).toHaveCount(
    0,
  );
  await shot(page, "02-restored-draft");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Durable idea" }),
  ).toBeVisible();
  expect(state.content).toBeNull();
  expect(state.publishes).toHaveLength(1);
  await shot(page, "03-published-cleared");
});

test("conflict preserves local text and offers confirmed overwrite", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Original" },
    version: 1,
    conflict: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Original",
  );
  await page.getByRole("textbox", { name: "Post title" }).fill("Local change");
  await expect(page.getByText(/changed elsewhere/i)).toBeVisible();
  await shot(page, "04-conflict-local-retained");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Overwrite saved draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.content.title).toBe("Local change");
  await shot(page, "05-confirmed-overwrite");
});

test("can reload remote after conflict", async ({ page }) => {
  await mockApi(page, {
    content: { ...blank, title: "Original" },
    version: 1,
    conflict: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Original",
  );
  await page.getByRole("textbox", { name: "Post title" }).fill("Local change");
  await expect(
    page.getByRole("button", { name: "Reload saved draft" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload saved draft" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Remote revision",
  );
  await shot(page, "06-reloaded-server");
});

test("confirmed discard clears the singleton draft", async ({ page }) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Discard me" },
    version: 1,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Discard me",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "",
  );
  expect(state.content).toBeNull();
  await shot(page, "07-discarded");
});

test("failed save keeps local text for retry", async ({ page }) => {
  await mockApi(page, { failOnce: true });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Retry idea");
  await expect(
    page.getByRole("button", { name: "Retry draft save" }),
  ).toBeVisible();
  await shot(page, "08-save-failed");
  await page.getByRole("button", { name: "Retry draft save" }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await shot(page, "09-retry-saved");
});

test("archived course restores draft read-only and allows confirmed discard", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Archived idea" },
    version: 1,
    archived: true,
  });
  await page.goto(
    `${origin}/attachments-fixture.html?post=none&status=archived`,
  );
  await page.getByRole("button", { name: "View saved draft" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Archived idea",
  );
  await expect(
    page.getByRole("textbox", { name: "Post title" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish post" }),
  ).toBeDisabled();
  await shot(page, "10-archived-restored");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  expect(state.content).toBeNull();
  await shot(page, "11-archived-discarded");
});

test("failed initial load stays locked until a single retry restores the draft", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Server draft" },
    version: 2,
    failGetOnce: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  const retry = page.getByRole("button", { name: "Retry loading draft" });
  await expect(retry).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Post title" }),
  ).toBeDisabled();
  await shot(page, "12-load-failed-retry-visible");
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Server draft",
  );
  await expect(page.getByRole("textbox", { name: "Post title" })).toBeEnabled();
  expect(state.writes).toHaveLength(0);
  await shot(page, "13-load-retry-restored");
});

test("transient overwrite error retains local text and both recovery actions", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Original" },
    version: 1,
    conflict: true,
    failOverwriteOnce: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Local change");
  await expect(
    page.getByRole("button", { name: "Overwrite saved draft" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Overwrite saved draft" }).click();
  await expect(page.getByText(/Draft not saved: Try again/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Local change",
  );
  await expect(
    page.getByRole("button", { name: "Overwrite saved draft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload saved draft" }),
  ).toBeVisible();
  await shot(page, "14-overwrite-error-recovery");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Overwrite saved draft" }).click();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.content.title).toBe("Local change");
});

test("stale publish keeps text and exposes conflict recovery", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Local title", bodyMarkdown: "Local body" },
    version: 2,
    stalePublish: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Local title",
  );
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("button", { name: "Reload saved draft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Overwrite saved draft" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Local title",
  );
  await expect(
    page.getByRole("button", { name: "Publish post" }),
  ).toBeDisabled();
  expect(state.publishes).toHaveLength(1);
  await shot(page, "15-stale-publish-recovery");
});

test("stale discard keeps text and exposes conflict recovery", async ({
  page,
}) => {
  const state = await mockApi(page, {
    content: { ...blank, title: "Local title" },
    version: 2,
    staleDiscard: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(
    page.getByRole("button", { name: "Reload saved draft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Overwrite saved draft" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Local title",
  );
  expect(state.content.title).toBe("Local title");
  await shot(page, "16-stale-discard-recovery");
});

test("saved draft overrides search suggestion with a visible notice", async ({
  page,
}) => {
  await mockApi(page, {
    content: { ...blank, title: "Saved question", bodyMarkdown: "Saved body" },
    version: 3,
  });
  await page.goto(
    `${origin}/attachments-fixture.html?post=none&q=Search%20title`,
  );
  await page
    .getByRole("button", { name: /Ask “Search title” as a new question/ })
    .click();
  await expect(
    page.getByText("Saved draft restored for this course."),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Saved question",
  );
  await expect(page.getByRole("textbox", { name: "Post body" })).toContainText(
    "Saved body",
  );
  await shot(page, "17-search-prefill-overridden");
});
