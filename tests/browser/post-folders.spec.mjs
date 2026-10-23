import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.POST_FOLDERS_SCREENSHOT_DIR ??
  resolve(root, "docs/pr-screenshots/post-folders");
const folderId = "01a0e5cc-58ae-7009-9f43-edde38b21440";
const folder = { id: folderId, name: "Week 1" };
let vite, origin;
test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
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

async function open(page, role, selected = true, deleteGate, saveGate) {
  let folders = [folder];
  let delayNextSave = Boolean(saveGate);
  let post = {
    id: "p1",
    courseId: "course-1",
    type: "question",
    deleted: false,
    title: "Chapter exercise",
    bodyMarkdown: "Consider the boundary condition.",
    author: {
      userId: "u1",
      displayName: "Alex",
      anonymous: false,
      deleted: false,
    },
    anonymous: false,
    tags: ["physics"],
    folder,
    createdAt: "2026-10-20T00:00:00Z",
    lastActivityAt: "2026-10-20T00:00:00Z",
    version: 1,
    private: false,
    duplicateStatus: "none",
    attachments: [],
    answered: false,
    unresolvedFollowups: 0,
    following: true,
    unread: false,
  };
  const requests = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const path = url.pathname,
      method = req.method();
    const respond = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (path === "/api/v1/courses/course-1/members/u1")
      return respond({ role });
    if (path === "/api/v1/courses/course-1/post-folders") {
      if (method === "GET") return respond(folders);
      if (method === "POST") {
        const name = req.postDataJSON().name.trim();
        folders = [...folders, { id: "new-folder", name }];
        requests.push({ method, name });
        return respond(folders.at(-1), 201);
      }
    }
    if (path === `/api/v1/courses/course-1/post-folders/${folderId}`) {
      if (method === "PATCH") {
        const name = req.postDataJSON().name.trim();
        folders = folders.map((item) =>
          item.id === folderId ? { ...item, name } : item,
        );
        post.folder = folders.find((item) => item.id === folderId);
        requests.push({ method, name });
        return respond(post.folder);
      }
      if (method === "DELETE") {
        requests.push({ method });
        if (deleteGate) await deleteGate;
        folders = folders.filter((item) => item.id !== folderId);
        if (post.folder?.id === folderId) {
          post.folder = null;
          post.version += 1;
        }
        return route.fulfill({ status: 204 });
      }
    }
    if (path === "/api/v1/courses/course-1/posts" && method === "GET") {
      requests.push({
        method,
        folder: url.searchParams.get("folder"),
        sort: url.searchParams.get("sort"),
      });
      const selected = url.searchParams.get("folder");
      const visible =
        !selected ||
        (selected === "unfiled"
          ? post.folder === null
          : selected === post.folder?.id);
      return route.fulfill({
        json: {
          data: visible ? [post] : [],
          page: { nextCursor: null, hasMore: false },
        },
      });
    }
    if (path === "/api/v1/courses/course-1/posts" && method === "POST") {
      const input = req.postDataJSON();
      requests.push({ method, input });
      post = {
        ...post,
        ...input,
        id: "p2",
        folder: folders.find((item) => item.id === input.folderId) ?? null,
        version: 1,
      };
      return respond(post, 201);
    }
    if (path === `/api/v1/posts/${post.id}` && method === "GET") {
      requests.push({ method, path });
      return respond(post);
    }
    if (path === `/api/v1/posts/${post.id}` && method === "PATCH") {
      const ifMatch = req.headers()["if-match"];
      const input = req.postDataJSON();
      requests.push({ method, path, ifMatch, input });
      if (ifMatch !== `"v${post.version}"`)
        return route.fulfill({
          status: 412,
          json: {
            error: {
              code: "version_conflict",
              message: "Post version changed",
            },
          },
        });
      post = {
        ...post,
        ...input,
        folder: folders.find((item) => item.id === input.folderId) ?? null,
        version: post.version + 1,
      };
      const saved = { ...post };
      if (delayNextSave) {
        delayNextSave = false;
        await saveGate;
      }
      return respond(saved);
    }
    if (path === `/api/v1/posts/${post.id}/answers`) return respond([]);
    if (path === `/api/v1/posts/${post.id}/followups`)
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    if (path === "/api/v1/courses/course-1/collaboration-sessions")
      return route.fulfill({
        json: { data: [], page: { nextCursor: null, hasMore: false } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  await page.goto(
    `${origin}/attachments-fixture.html?post=${selected ? "p1" : "none"}`,
  );
  await expect(page.getByText("Chapter exercise").first()).toBeVisible();
  return { requests };
}

test("staff rename and delete a folder on desktop", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const state = await open(page, "ta");
  const filter = page.getByRole("combobox", { name: "Filter by folder" });
  await filter.selectOption(folderId);
  await expect.poll(() => state.requests.at(-1)?.folder).toBe(folderId);
  await page.getByText("Manage folders").click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("textbox", { name: "Rename Week 1" }).fill("Week A");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page
      .getByRole("button", { name: "Delete" })
      .locator("xpath=..", { hasText: "Week A" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(filter).toHaveValue("unfiled");
  await expect.poll(() => state.requests.at(-1)?.folder).toBe("unfiled");
  await expect(page.getByText("Chapter exercise").first()).toBeVisible();
  await expect(page.locator(".post-card-foot .post-card-extras")).toHaveText(
    "Unfiled",
  );
  await page.screenshot({
    path: resolve(screenshots, "desktop-staff-manage.png"),
    fullPage: true,
  });
  expect(state.requests.some((request) => request.method === "PATCH")).toBe(
    true,
  );
  expect(state.requests.some((request) => request.method === "DELETE")).toBe(
    true,
  );
});

test("staff folder names count supplementary letters as characters", async ({
  page,
}) => {
  const state = await open(page, "ta", false);
  const letter = "𐐀";
  await page.getByText("Manage folders").click();
  const name = page.getByRole("textbox", { name: "New folder name" });
  await name.fill(letter.repeat(65));
  await expect(page.getByRole("button", { name: "Add folder" })).toBeDisabled();
  await expect(
    page.getByText("Folder name must be at most 64 characters."),
  ).toBeVisible();
  await name.fill(letter.repeat(40));
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(
    page
      .getByRole("list", { name: "Managed folders" })
      .getByText(letter.repeat(40)),
  ).toBeVisible();
  await page
    .getByRole("list", { name: "Managed folders" })
    .getByRole("listitem")
    .filter({ hasText: "Week 1" })
    .getByRole("button", { name: "Rename" })
    .click();
  const rename = page.getByRole("textbox", { name: "Rename Week 1" });
  await rename.fill(letter.repeat(65));
  await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled();
  await rename.fill(letter.repeat(64));
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page
      .getByRole("list", { name: "Managed folders" })
      .getByText(letter.repeat(64)),
  ).toBeVisible();
  expect(
    state.requests.filter((request) => request.method === "POST"),
  ).toHaveLength(1);
  expect(
    state.requests.filter((request) => request.method === "PATCH"),
  ).toHaveLength(1);
  await page.screenshot({
    path: resolve(screenshots, "desktop-unicode-folder-names.png"),
    fullPage: true,
  });
});

test("folder management preserves an unsaved post edit", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  const state = await open(page, "ta");
  await page.getByRole("button", { name: "Edit post" }).click();
  const detailReads = state.requests.filter(
    (request) => request.path === "/api/v1/posts/p1",
  ).length;
  const title = page.getByRole("textbox", { name: "Post title" });
  const tags = page.getByRole("textbox", { name: "Tags (comma-separated)" });
  const editorFolder = page.getByRole("combobox", { name: "Post folder" });
  await title.fill("Unsaved chapter draft");
  await tags.fill("draft-tag");
  await page.getByText("Manage folders").click();
  await page.getByRole("textbox", { name: "New folder name" }).fill("Week Two");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(
    editorFolder.locator("option", { hasText: "Week Two" }),
  ).toHaveCount(1);
  await expect(title).toHaveValue("Unsaved chapter draft");
  await page.getByRole("button", { name: "Rename" }).first().click();
  await page.getByRole("textbox", { name: "Rename Week 1" }).fill("Week A");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    editorFolder.locator("option", { hasText: "Week A" }),
  ).toHaveCount(1);
  await expect(title).toHaveValue("Unsaved chapter draft");
  await page
    .getByRole("list", { name: "Managed folders" })
    .getByRole("listitem")
    .filter({ hasText: "Week A" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(editorFolder).toHaveValue("");
  await expect(title).toHaveValue("Unsaved chapter draft");
  await expect(tags).toHaveValue("draft-tag");
  await expect(
    editorFolder.locator("option", { hasText: "Week Two" }),
  ).toHaveCount(1);
  expect(
    state.requests.filter((request) => request.path === "/api/v1/posts/p1"),
  ).toHaveLength(detailReads);
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(
    page.getByRole("heading", { name: "Unsaved chapter draft" }),
  ).toBeVisible();
  expect(
    state.requests.find(
      (request) =>
        request.method === "PATCH" && request.path === "/api/v1/posts/p1",
    ),
  ).toMatchObject({
    ifMatch: '"v2"',
    input: {
      title: "Unsaved chapter draft",
      tags: ["draft-tag"],
      folderId: null,
    },
  });
  await page.screenshot({
    path: resolve(screenshots, "desktop-staff-draft.png"),
    fullPage: true,
  });
});

test("a late save response retains the deleted folder's newer revision", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  let releaseSave;
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const state = await open(page, "ta", true, undefined, saveGate);
  await page.getByRole("button", { name: "Edit post" }).click();
  const title = page.getByRole("textbox", { name: "Post title" });
  const tags = page.getByRole("textbox", { name: "Tags (comma-separated)" });
  await title.fill("Saved before deletion");
  await page.getByRole("button", { name: "Save post" }).click();
  await expect
    .poll(
      () =>
        state.requests.filter(
          (request) =>
            request.method === "PATCH" && request.path === "/api/v1/posts/p1",
        ).length,
    )
    .toBe(1);
  await page.getByText("Manage folders").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("combobox", { name: "Post folder" })).toHaveValue(
    "",
  );
  await title.fill("Unsent after deletion");
  await tags.fill("new-tag");
  releaseSave();
  await expect(page.getByRole("button", { name: "Save post" })).toBeEnabled();
  await expect(title).toHaveValue("Unsent after deletion");
  await page.getByRole("button", { name: "Save post" }).click();
  await expect(
    page.getByRole("heading", { name: "Unsent after deletion" }),
  ).toBeVisible();
  expect(
    state.requests.filter(
      (request) =>
        request.method === "PATCH" && request.path === "/api/v1/posts/p1",
    ),
  ).toMatchObject([
    { ifMatch: '"v1"', input: { title: "Saved before deletion" } },
    {
      ifMatch: '"v3"',
      input: {
        title: "Unsent after deletion",
        tags: ["new-tag"],
        folderId: null,
      },
    },
  ]);
  await page.screenshot({
    path: resolve(screenshots, "desktop-late-save-folder-delete.png"),
    fullPage: true,
  });
});

test("deleting a composer folder preserves its other draft fields", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const state = await open(page, "ta", false);
  await page.getByRole("button", { name: "Create post" }).click();
  const title = page.getByRole("textbox", { name: "Post title" });
  const body = page.getByRole("textbox", { name: "Post body" });
  const tags = page.getByRole("textbox", { name: "Tags (comma-separated)" });
  const composerFolder = page.getByRole("combobox", { name: "Post folder" });
  await title.fill("Unsent folder question");
  await body.fill("Please explain this step.");
  await tags.fill("physics");
  await page.getByRole("checkbox", { name: "Post anonymously" }).check();
  await composerFolder.selectOption(folderId);
  await page.getByText("Manage folders").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(composerFolder).toHaveValue("");
  await expect(title).toHaveValue("Unsent folder question");
  await expect(body).toHaveText("Please explain this step.");
  await expect(tags).toHaveValue("physics");
  await expect(
    page.getByRole("checkbox", { name: "Post anonymously" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Unsent folder question" }),
  ).toBeVisible();
  const published = state.requests.find((request) => request.method === "POST");
  expect(published?.input).toMatchObject({
    folderId: null,
    title: "Unsent folder question",
    bodyMarkdown: "Please explain this step.",
    tags: ["physics"],
    anonymous: true,
  });
  await page.screenshot({
    path: resolve(screenshots, "desktop-composer-deleted-folder.png"),
    fullPage: true,
  });
});

test("folder deletion preserves filters changed while pending", async ({
  page,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  let releaseDelete;
  const deleteGate = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  const state = await open(page, "ta", true, deleteGate);
  const filter = page.getByRole("combobox", { name: "Filter by folder" });
  await filter.selectOption(folderId);
  await page.getByText("Manage folders").click();
  const deleteClick = page.getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(() => state.requests.some((request) => request.method === "DELETE"))
    .toBe(true);
  await filter.selectOption("");
  const sortToggle = page.getByRole("button", { name: /^Sort by/ });
  if ((await sortToggle.getAttribute("aria-expanded")) === "false")
    await sortToggle.click();
  await page
    .getByRole("group", { name: "Sort by" })
    .getByText("Oldest")
    .click();
  await expect.poll(() => state.requests.at(-1)?.sort).toBe("oldest");
  releaseDelete();
  await deleteClick;
  await expect(page.locator(".post-card-foot .post-card-extras")).toHaveText(
    "Unfiled",
  );
  await expect(filter).toHaveValue("");
  await expect(
    page
      .getByRole("group", { name: "Sort by" })
      .getByRole("radio", { name: "Oldest" }),
  ).toBeChecked();
  await expect.poll(() => state.requests.at(-1)?.folder).toBe(null);
  await expect.poll(() => state.requests.at(-1)?.sort).toBe("oldest");
  await page.screenshot({
    path: resolve(screenshots, "desktop-pending-folder-delete.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "New folder name" }).fill("Week Two");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(
    page.getByRole("list", { name: "Managed folders" }).getByText("Week Two"),
  ).toBeVisible();
  await expect(filter).toHaveValue("");
  await expect.poll(() => state.requests.at(-1)?.folder).toBe(null);
  await expect.poll(() => state.requests.at(-1)?.sort).toBe("oldest");
});

test("student filters a folder and sees Unfiled on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await open(page, "student", false);
  await page.getByRole("button", { name: /Folders/ }).click();
  await page
    .getByRole("combobox", { name: "Filter by folder" })
    .selectOption(folderId);
  await expect.poll(() => state.requests.at(-1)?.folder).toBe(folderId);
  await expect(page.locator(".post-card-foot .post-card-extras")).toHaveText(
    "Week 1",
  );
  await page.screenshot({
    path: resolve(screenshots, "mobile-folder-filter.png"),
    fullPage: true,
  });
});

test("student publishes a post in a staff-created folder", async ({ page }) => {
  const state = await open(page, "student", false);
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Folder question");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("Please explain the first step.");
  await page
    .getByRole("combobox", { name: "Post folder" })
    .selectOption(folderId);
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Folder question" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Post detail" })
      .locator(".post-folder-label"),
  ).toHaveText("Week 1");
  expect(
    state.requests.find((request) => request.method === "POST")?.input.folderId,
  ).toBe(folderId);
  await page.screenshot({
    path: resolve(screenshots, "student-published-folder.png"),
    fullPage: true,
  });
});
