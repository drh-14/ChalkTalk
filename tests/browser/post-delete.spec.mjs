import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "test-results/browser-screenshots/post-delete");
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
    if (path === "/api/v1/sessions/current")
      return route.fulfill({
        json: {
          data: {
            id: "session",
            user: {
              id: "u1",
              displayName: "Course TA",
              email: "ta@example.edu",
            },
            csrfToken: "fixture-csrf",
            expiresAt: "2090-01-01T00:00:00Z",
          },
        },
      });
    if (path === "/api/v1/courses/course-1")
      return route.fulfill({
        json: {
          data: {
            id: "course-1",
            name: "Physics",
            status: "active",
            organizationId: "org-1",
            allowAnonymousPosting: true,
            allowPrivatePosting: true,
          },
        },
        headers: { ETag: '"v1"' },
      });
    if (
      path === "/api/v1/users/me/notifications/unread-count" ||
      path === "/api/v1/courses/course-1/threads/unread-count"
    )
      return route.fulfill({ json: { data: { count: 0 } } });
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

test("Markdown website and file links open separate safe tabs while app routes stay put", async ({
  page,
}) => {
  await mockApi(page, {
    postData: {
      ...post,
      bodyMarkdown:
        "[Website](https://example.edu/guide) [Notes](/documents/notes.pdf) [Course settings](/courses/course-1/settings)",
    },
  });
  await page.route("https://example.edu/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Guide</h1>" }),
  );
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  for (const [name, destination] of [
    ["Website", "https://example.edu/guide"],
    ["Notes", `${origin}/documents/notes.pdf`],
  ]) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const popupEvent = page.waitForEvent("popup");
    await link.click();
    const popup = await popupEvent;
    await expect.poll(() => popup.url()).toBe(destination);
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(page).toHaveURL(/\/posts\/p1$/);
  }
  await shot(page, "markdown-links-current-post");
  const internal = page
    .getByRole("region", { name: "Post detail" })
    .getByRole("link", { name: "Course settings", exact: true });
  await expect(internal).not.toHaveAttribute("target", "_blank");
  await internal.click();
  await expect(page).toHaveURL(/\/courses\/course-1\/settings$/);
  await shot(page, "markdown-internal-route");
});

test("ChalkTalk confirmation keeps the post on Cancel and deletes once on Confirm", async ({
  page,
}) => {
  const deletes = await mockApi(page);
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => {
    nativeDialogs++;
    void dialog.dismiss();
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await page.getByRole("button", { name: "Delete post" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete post" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This cannot be undone");
  await shot(page, "styled-confirmation-open");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: post.title })).toBeVisible();
  expect(deletes).toHaveLength(0);
  await shot(page, "styled-confirmation-cancelled");
  await page.getByRole("button", { name: "Delete post" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("No posts yet.")).toBeVisible();
  expect(deletes).toHaveLength(1);
  expect(nativeDialogs).toBe(0);
  await shot(page, "styled-confirmation-completed");
});

test("ChalkTalk confirmation is usable on mobile and Escape cancels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const deletes = await mockApi(page);
  await page.goto(`${origin}/attachments-fixture.html`);
  await page.getByRole("button", { name: "Delete post" }).click();
  await expect(page.getByRole("dialog", { name: "Delete post" })).toBeVisible();
  await shot(page, "styled-confirmation-mobile-open");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(deletes).toHaveLength(0);
  await shot(page, "styled-confirmation-mobile-cancelled");
});

test("guarded course navigation waits for styled confirmation", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1/posts/p1`);
  await expect(page.getByRole("button", { name: "Edit post" })).toBeVisible();
  await page.getByRole("button", { name: "Edit post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Unsaved change");
  await page.getByRole("link", { name: "Course settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await shot(page, "styled-navigation-guard-open");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Unsaved change",
  );
  await shot(page, "styled-navigation-guard-cancelled");
  await page.getByRole("link", { name: "Course settings" }).click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await shot(page, "styled-navigation-guard-confirmed");
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
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(deletes).toHaveLength(0);
      await expect(
        page.getByRole("heading", { name: post.title }),
      ).toBeVisible();
      await shot(page, `${size}-cancelled`);
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
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
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
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
      await page.getByRole("button", { name: "Delete post" }).click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
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
      await page.goto(`${origin}/attachments-fixture.html`);
      await page.getByRole("button", { name: "Edit post" }).click();
      const title = page.getByRole("textbox", { name: "Post title" });
      await title.fill("My unsaved draft");
      const action = page.getByRole("button", { name: "Delete post" });
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(page.getByText("Post changed")).toBeVisible();
      await expect(title).toHaveValue("My unsaved draft");
      await expect.poll(() => reads).toEqual([2, 3]);
      expect(deletes).toHaveLength(1);
      expect(deletes[0]["if-match"]).toBe('"v2"');
      await shot(page, `${size}-stale-delete-keeps-draft`);
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
      await expect(page.getByText("No posts yet.")).toBeVisible();
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
      await action.click();
      await page
        .getByRole("dialog", { name: "Delete post" })
        .getByRole("button", { name: "Delete" })
        .click();
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

test("guarded browser Back and Forward preserve history without duplicate entries", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1`);
  await page.getByRole("link", { name: /Question for moderation/ }).click();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await page.getByRole("button", { name: "Edit post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Unsaved change");
  const length = await page.evaluate(() => globalThis.history.length);
  await page.goBack({ waitUntil: "commit" });
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await shot(page, "styled-back-guard-open");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  expect(await page.evaluate(() => globalThis.history.length)).toBe(length);
  await page.goBack({ waitUntil: "commit" });
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/courses\/course-1$/);
  await page.goForward({ waitUntil: "commit" });
  await expect(page).toHaveURL(/\/posts\/p1$/);
  expect(await page.evaluate(() => globalThis.history.length)).toBe(length);
  await shot(page, "styled-back-forward-completed");
});

test("repeated Back while confirmation is pending leaves navigation usable", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1`);
  await page.getByRole("link", { name: "Course settings" }).click();
  await page.getByRole("link", { name: "Discussion" }).click();
  await page.getByRole("link", { name: /Question for moderation/ }).click();
  await page.getByRole("button", { name: "Edit post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Unsaved change");
  const currentIndex = await page.evaluate(() => {
    window.__guardHistoryTrace = [];
    window.addEventListener("popstate", () => {
      window.__guardHistoryTrace.push(history.state?.chalktalkIndex);
    });
    return history.state.chalktalkIndex;
  });
  await page.evaluate(() => history.back());
  const dialog = page.getByRole("dialog", { name: "Confirm action" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__guardHistoryTrace))
    .toEqual([currentIndex - 1, currentIndex]);
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await page.evaluate(() => history.back());
  await expect
    .poll(() => page.evaluate(() => window.__guardHistoryTrace))
    .toEqual([currentIndex - 1, currentIndex, currentIndex - 1, currentIndex]);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/posts\/p1$/);
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Unsaved change",
  );
  await shot(page, "repeated-back-cancelled");
  await page.goBack({ waitUntil: "commit" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/courses\/course-1$/);
  await shot(page, "repeated-back-confirmed");
});

test("live search URL replacements do not replay page entrance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    globalThis.__pageEntrances = 0;
    const original = globalThis.Element.prototype.animate;
    globalThis.Element.prototype.animate = function (frames, options) {
      if (this.id === "root") globalThis.__pageEntrances++;
      return original.call(this, frames, options);
    };
  });
  await mockApi(page);
  await page.goto(`${origin}/courses/course-1`);
  await expect(
    page.getByRole("searchbox", { name: "Search posts" }),
  ).toBeVisible();
  const before = await page.evaluate(() => globalThis.__pageEntrances);
  await page.getByRole("searchbox", { name: "Search posts" }).fill("question");
  await expect(page).toHaveURL(/\?q=question/);
  expect(await page.evaluate(() => globalThis.__pageEntrances)).toBe(before);
  await shot(page, "search-without-page-entrance");
});
