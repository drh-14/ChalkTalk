import { mkdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshots = resolve(
  root,
  "docs/pr-screenshots/course-discussion-controls",
);
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

const baseCourse = {
  id: "course-1",
  organizationId: "org-1",
  name: "Physics",
  status: "active",
  joinCode: "ABCDEFGH",
  allowAnonymousPosting: true,
  allowPrivatePosting: true,
  allowFollowupResolution: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
};
const post = {
  id: "post-1",
  courseId: "course-1",
  type: "question",
  deleted: false,
  title: "How does light bend?",
  bodyMarkdown: "Explain refraction.",
  author: {
    userId: "user-1",
    displayName: "Alex",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  private: false,
  tags: [],
  attachments: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  lastActivityAt: "2026-10-01T00:00:00Z",
  version: 1,
};
const followup = {
  id: "followup-1",
  postId: "post-1",
  parentId: null,
  author: { id: "user-1", displayName: "Alex" },
  anonymous: false,
  bodyMarkdown: "I figured it out.",
  deleted: false,
  resolved: true,
  canResolve: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount: 0,
  attachments: [],
};
async function mockApi(
  page,
  { role = "student", restricted = false, rejectPost = false } = {},
) {
  let course = {
    ...baseCourse,
    joinCode: role === "instructor" ? baseCourse.joinCode : null,
    ...(restricted
      ? {
          allowAnonymousPosting: false,
          allowPrivatePosting: false,
          allowFollowupResolution: false,
        }
      : {}),
  };
  const patches = [];
  const member = {
    id: "membership-1",
    courseId: course.id,
    user: { id: "user-1", displayName: "Alex" },
    role,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    version: 1,
  };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const respond = (data, status = 200, headers = {}) =>
      route.fulfill({ status, json: { data }, headers });
    if (path === "/api/v1/sessions/current")
      return respond({
        id: "session-1",
        user: { id: "user-1", displayName: "Alex", email: "alex@example.edu" },
        csrfToken: "csrf",
        expiresAt: "2090-01-01T00:00:00Z",
      });
    if (path === "/api/v1/courses/course-1" && method === "PATCH") {
      patches.push({
        input: req.postDataJSON(),
        etag: req.headers()["if-match"],
      });
      course = {
        ...course,
        ...req.postDataJSON(),
        version: course.version + 1,
      };
      return respond(course, 200, { ETag: `"v${course.version}"` });
    }
    if (path === "/api/v1/courses/course-1")
      return respond(course, 200, { ETag: `"v${course.version}"` });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return respond(member, 200, { ETag: '"v1"' });
    if (path === "/api/v1/courses/course-1/members")
      return route.fulfill({
        json: { data: [member], page: { hasMore: false, nextCursor: null } },
      });
    if (path === "/api/v1/courses")
      return route.fulfill({
        json: { data: [course], page: { hasMore: false, nextCursor: null } },
      });
    if (path === "/api/v1/courses/course-1/posts" && method === "POST") {
      if (rejectPost)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "anonymous_posting_disabled",
              message: "Anonymous posting is disabled for this course",
            },
          },
        });
      return respond({ ...post, ...req.postDataJSON(), id: "post-2" }, 201);
    }
    if (path === "/api/v1/courses/course-1/posts")
      return route.fulfill({
        json: { data: [post], page: { hasMore: false, nextCursor: null } },
      });
    if (path === "/api/v1/posts/post-1")
      return respond(post, 200, { ETag: '"v1"' });
    if (path === "/api/v1/posts/post-1/answers") return respond([]);
    if (path === "/api/v1/posts/post-1/followups")
      return route.fulfill({
        json: { data: [followup], meta: { total: 1, nextCursor: null } },
      });
    if (path === "/api/v1/followups/followup-1/replies")
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    if (path.endsWith("/notifications/count")) return respond({ unread: 0 });
    if (path.endsWith("/notifications"))
      return route.fulfill({
        json: { data: [], page: { hasMore: false, nextCursor: null } },
      });
    if (path.endsWith("/collaboration-sessions"))
      return route.fulfill({
        json: { data: [], page: { hasMore: false, nextCursor: null } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });
  return { patches };
}

test("instructor changes a discussion control from settings", async ({
  page,
}) => {
  const { patches } = await mockApi(page, { role: "instructor" });
  await page.goto(`${origin}/courses/course-1/settings`);
  const anonymity = page.getByRole("checkbox", {
    name: "Allow anonymous posting",
  });
  await expect(anonymity).toBeChecked();
  await page.screenshot({
    path: resolve(screenshots, "instructor-settings-before.png"),
  });
  await anonymity.click();
  await expect(anonymity).not.toBeChecked();
  expect(patches).toEqual([
    { input: { allowAnonymousPosting: false }, etag: '"v1"' },
  ]);
  await page.screenshot({
    path: resolve(screenshots, "instructor-settings-after.png"),
  });
});

test("student sees disabled policy, restricted composers, and preserved resolution", async ({
  page,
}) => {
  await mockApi(page, { restricted: true });
  await page.goto(`${origin}/courses/course-1/settings`);
  await expect(
    page.getByText("Allow anonymous posting: Disabled"),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Allow anonymous posting" }),
  ).toHaveCount(0);
  await expect(page.getByText("Join code", { exact: true })).toHaveCount(0);
  await expect(page.getByText(baseCourse.joinCode)).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "student-readonly-settings.png"),
  });
  await page.goto(`${origin}/courses/course-1`);
  await page.getByRole("button", { name: "Create post" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Post anonymously" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: "Instructors and TAs" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "restricted-new-post.png"),
  });
  await page.goto(`${origin}/courses/course-1/posts/post-1`);
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Discussion status" }),
  ).toHaveCount(0);
  await page.getByText("Resolved", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshots, "preserved-resolution.png"),
  });
  await page.getByRole("button", { name: "Start students' answer" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Post anonymously" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "restricted-answer-and-resolution.png"),
  });
});

test("a stale composer shows the server policy rejection without publishing", async ({
  page,
}) => {
  await mockApi(page, { rejectPost: true });
  await page.goto(`${origin}/courses/course-1`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("A new question");
  await page.getByRole("textbox", { name: "Post body" }).click();
  await page.keyboard.type("Will this still publish?");
  await page.getByRole("checkbox", { name: "Post anonymously" }).check();
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Anonymous posting is disabled for this course",
  );
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "A new question",
  );
  await page.screenshot({
    path: resolve(screenshots, "stale-composer-rejected.png"),
  });
});
