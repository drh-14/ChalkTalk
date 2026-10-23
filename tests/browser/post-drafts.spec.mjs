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

const stored = (id, content, version = 1) => ({
  id,
  courseId: "course-1",
  content,
  createdAt: "2026-10-21T12:00:00Z",
  updatedAt: "2026-10-21T12:00:00Z",
  version,
});
const blank = {
  type: "question",
  title: "",
  bodyMarkdown: "",
  anonymous: false,
  tags: [],
};

async function mockApi(
  page,
  {
    drafts = [],
    conflict = false,
    failOnce = false,
    holdSave = false,
    role = "student",
  } = {},
) {
  let releaseSave;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const state = {
    drafts: [...drafts],
    publish: [],
    draftWrites: [],
    releaseSave: () => releaseSave(),
  };
  let nextId = 1;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (data, status = 200, headers = {}) =>
      route.fulfill({ status, json: { data }, headers });
    if (path.endsWith("/members/u1")) return json({ role });
    if (path.endsWith("/posts") && method === "GET")
      return route.fulfill({
        json: { data: [], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/post-drafts") && method === "GET")
      return json(state.drafts);
    if (path.endsWith("/post-drafts") && method === "POST") {
      state.draftWrites.push(request.postDataJSON());
      if (holdSave) {
        holdSave = false;
        await saveGate;
      }
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status: 503,
          json: {
            error: { code: "service_unavailable", message: "Try again" },
          },
        });
      }
      const draft = stored(
        `draft-new-${nextId++}`,
        request.postDataJSON().content,
      );
      state.drafts.unshift(draft);
      return json(draft, 201, { ETag: '"v1"' });
    }
    const match = path.match(/\/post-drafts\/([^/]+)$/);
    if (match) {
      const draft = state.drafts.find((item) => item.id === match[1]);
      if (!draft)
        return route.fulfill({
          status: 404,
          json: { error: { code: "not_found", message: "Not found" } },
        });
      if (method === "GET")
        return json(draft, 200, { ETag: `"v${draft.version}"` });
      if (method === "DELETE") {
        state.drafts = state.drafts.filter((item) => item.id !== draft.id);
        return route.fulfill({ status: 204, body: "" });
      }
      if (method === "PUT") {
        state.draftWrites.push(request.postDataJSON());
        if (conflict) {
          conflict = false;
          draft.content = { ...draft.content, title: "Remote revision" };
          draft.version += 1;
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Changed elsewhere" },
            },
          });
        }
        expect(request.headers()["if-match"]).toBe(`"v${draft.version}"`);
        draft.content = request.postDataJSON().content;
        draft.version += 1;
        return json(draft, 200, { ETag: `"v${draft.version}"` });
      }
    }
    if (path.endsWith("/posts") && method === "POST") {
      const input = request.postDataJSON();
      state.publish.push(input);
      const draft = state.drafts.find((item) => item.id === input.draftId);
      expect(draft?.version).toBe(input.draftVersion);
      state.drafts = state.drafts.filter((item) => item.id !== input.draftId);
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
          createdAt: "2026-10-21T12:00:00Z",
          lastActivityAt: "2026-10-21T12:00:00Z",
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
        createdAt: "2026-10-21T12:00:00Z",
        lastActivityAt: "2026-10-21T12:00:00Z",
        version: 1,
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  return state;
}

const shot = (page, name) =>
  page.screenshot({
    path: resolve(screenshots, `${name}.png`),
    fullPage: true,
  });

test("autosaves, reloads, reopens, and publishes a private new-post draft", async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Durable idea");
  await page.getByRole("textbox", { name: "Post body" }).fill("Saved body");
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.drafts).toHaveLength(1);
  await shot(page, "01-saved-draft");
  await page.getByLabel("Add files").setInputFiles({
    name: "device-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not durable"),
  });
  const selectedFiles = page.getByRole("list", { name: "Selected files" });
  await expect(selectedFiles).toContainText("device-only.txt");
  await selectedFiles.scrollIntoViewIfNeeded();
  await expect(selectedFiles).toBeInViewport();
  await shot(page, "01b-queued-attachment-device-only");
  await page.reload();
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await page.getByRole("button", { name: "Durable idea", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Post body" })).toContainText(
    "Saved body",
  );
  await expect(
    page.getByText(/Attachments are not saved with drafts/),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Selected files" })).toHaveCount(
    0,
  );
  expect(JSON.stringify(state.draftWrites)).not.toContain("device-only.txt");
  await shot(page, "02-reopened-draft");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Durable idea" }),
  ).toBeVisible();
  expect(state.publish).toHaveLength(1);
  expect(state.drafts).toHaveLength(0);
  await shot(page, "03-published-draft");
});

test("preserves local edits on conflict and saves them as a separate draft", async ({
  page,
}) => {
  const state = await mockApi(page, {
    drafts: [stored("draft-one", { ...blank, title: "Original" })],
    conflict: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Original",
  );
  await page.getByRole("textbox", { name: "Post title" }).fill("Local change");
  await expect(page.getByText(/changed elsewhere/i)).toBeVisible();
  await shot(page, "04-conflict-local-retained");
  await page.getByRole("button", { name: "Save local as new draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  expect(state.drafts).toHaveLength(2);
  expect(
    state.drafts.find((item) => item.id === "draft-one").content.title,
  ).toBe("Remote revision");
  await shot(page, "05-conflict-recovered-as-new");
});

test("can explicitly reload the server revision after a save conflict", async ({
  page,
}) => {
  await mockApi(page, {
    drafts: [stored("draft-reload", { ...blank, title: "Original" })],
    conflict: true,
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Original",
  );
  await page.getByRole("textbox", { name: "Post title" }).fill("Local change");
  await expect(
    page.getByRole("button", { name: "Reload server draft" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload server draft" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Remote revision",
  );
  await expect(
    page.getByRole("button", { name: "Save local as new draft" }),
  ).toHaveCount(0);
  await shot(page, "05b-conflict-reloaded-server");
});

test("shows an archived draft read-only and allows discarding it", async ({
  page,
}) => {
  const state = await mockApi(page, {
    drafts: [stored("draft-archived", { ...blank, title: "Archived idea" })],
  });
  await page.goto(
    `${origin}/attachments-fixture.html?post=none&status=archived`,
  );
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await page
    .getByRole("button", { name: "Archived idea", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Post title" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish post" }),
  ).toBeDisabled();
  await shot(page, "06-archived-read-only");
  await page.getByRole("button", { name: "Discard Archived idea" }).click();
  await expect(page.getByText("No saved drafts yet.")).toBeVisible();
  expect(state.drafts).toHaveLength(0);
  await shot(page, "07-archived-discarded");
});

test("keeps local text and offers retry after a failed autosave", async ({
  page,
}) => {
  await mockApi(page, { failOnce: true });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Retry this idea");
  await expect(
    page.getByRole("button", { name: "Retry draft save" }),
  ).toBeVisible();
  await shot(page, "08-save-failure");
  await page.getByRole("button", { name: "Retry draft save" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await shot(page, "09-save-recovered");
});

test("blocks closing while the latest draft save is pending, then leaves after success", async ({
  page,
}) => {
  const state = await mockApi(page, { holdSave: true });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("textbox", { name: "Post title" }).fill("Wait for save");
  await page.getByRole("button", { name: "Close composer" }).click();
  await expect(
    page.getByText(/Saving latest draft before leaving/),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Wait for save",
  );
  await shot(page, "09b-leave-blocked-saving");
  state.releaseSave();
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close composer" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveCount(
    0,
  );
  await shot(page, "09c-left-after-save");
});

test("preserves failed leave content until the member explicitly discards it", async ({
  page,
}) => {
  await mockApi(page, { failOnce: true });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Local unsaved text");
  await page.getByRole("button", { name: "Close composer" }).click();
  await expect(
    page.getByRole("button", { name: "Discard unsaved changes and close" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Local unsaved text",
  );
  await shot(page, "09d-leave-save-failed");
  await page
    .getByRole("button", { name: "Discard unsaved changes and close" })
    .click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveCount(
    0,
  );
  await shot(page, "09e-explicit-discard-after-failure");
});

test.describe("mobile draft layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("reopens a saved draft on a narrow screen", async ({ page }) => {
    await mockApi(page, {
      drafts: [
        stored("draft-mobile", {
          ...blank,
          title: "Mobile idea",
          bodyMarkdown: "Small screen body",
        }),
      ],
    });
    await page.goto(`${origin}/attachments-fixture.html?post=none`);
    await page.getByRole("button", { name: "Saved drafts" }).click();
    await page
      .getByRole("button", { name: "Mobile idea", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
      "Mobile idea",
    );
    await expect(
      page.getByRole("textbox", { name: "Post body" }),
    ).toContainText("Small screen body");
    await shot(page, "10-mobile-reopened");
  });
});

test("preserves CRLF metadata at the raw length limit in the composer", async ({
  page,
}) => {
  const boundary = `${"x".repeat(198)}\r\n`;
  const state = await mockApi(page, {
    role: "ta",
    drafts: [
      stored("draft-crlf", {
        ...blank,
        type: "poll",
        title: boundary,
        options: [boundary, "Second option"],
      }),
    ],
  });
  await page.goto(`${origin}/attachments-fixture.html?post=none`);
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await page.getByRole("button", { name: /^x/ }).click();
  const title = page.getByRole("textbox", { name: "Post title" });
  const option = page.getByRole("textbox", { name: "Option 1" });
  await expect(title).toHaveValue(`${"x".repeat(198)}\n`);
  await expect(option).toHaveValue(`${"x".repeat(198)}\n`);
  await title.press("End");
  await title.press("y");
  await option.press("End");
  await option.press("y");
  await expect(title).toHaveValue(`${"x".repeat(198)}\n`);
  await expect(option).toHaveValue(`${"x".repeat(198)}\n`);
  await page.getByRole("textbox", { name: "Post body" }).fill("Edited body");
  await expect.poll(() => state.draftWrites.length).toBe(1);
  await expect(page.getByText("Draft saved.", { exact: true })).toBeVisible();
  expect(state.draftWrites.at(-1).content).toMatchObject({
    title: boundary,
    options: [boundary, "Second option"],
  });
  await shot(page, "11-crlf-metadata-boundary");
  await title.scrollIntoViewIfNeeded();
  await shot(page, "11b-crlf-title-boundary");
});
