import process from "node:process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/course-destructive-confirmations");
mkdirSync(screenshots, { recursive: true });

const timestamp = "2026-11-03T00:00:00Z";
const baseCourse = {
  id: "course-1",
  organizationId: "org-1",
  name: "Linear Algebra",
  status: "active",
  joinCode: "ABCDEFGH",
  allowAnonymousPosting: true,
  allowPrivatePosting: true,
  allowFollowupResolution: true,
  createdAt: timestamp,
  updatedAt: timestamp,
  version: 1,
};
const own = {
  id: "membership-1",
  courseId: "course-1",
  user: { id: "instructor-1", displayName: "Ada Lovelace" },
  role: "instructor",
  createdAt: timestamp,
  updatedAt: timestamp,
  version: 1,
};
const student = {
  id: "membership-2",
  courseId: "course-1",
  user: { id: "student-1", displayName: "Grace Hopper" },
  role: "student",
  createdAt: timestamp,
  updatedAt: timestamp,
  version: 1,
};
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
test.afterAll(async () => vite?.close());

async function openSettings(
  page,
  { staleCourse = false, staleMember = false, emailPrefs = false } = {},
) {
  let course = { ...baseCourse };
  let members = [own, student];
  let member = { ...student };
  let memberEtag = '"m:550e8400-e29b-41d4-a716-446655440000:v1"';
  let ownVersion = 1;
  let preferences = {
    activityEmails: false,
    announcementEmails: true,
    digestEmails: true,
  };
  const deletes = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const send = (data, status = 200, etag = '"v1"') =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { ETag: etag },
        body: JSON.stringify({ data }),
      });
    if (path === "/api/v1/sessions/current")
      return send({
        id: "session-1",
        user: {
          id: own.user.id,
          displayName: own.user.displayName,
          email: "ada@example.edu",
        },
        csrfToken: "csrf",
        expiresAt: "2090-01-01T00:00:00Z",
      });
    if (path === "/api/v1/courses/course-1" && method === "DELETE") {
      deletes.push("course");
      if (staleCourse && deletes.length === 1) {
        course = { ...course, name: "Advanced Linear Algebra", version: 2 };
        return route.fulfill({
          status: 412,
          json: {
            error: { code: "version_conflict", message: "Course changed" },
          },
        });
      }
      course = { ...course, status: "deleting", version: course.version + 1 };
      return send(course, 202, `"v${course.version}"`);
    }
    if (path === "/api/v1/courses/course-1" && method === "GET")
      return send(course, 200, `"v${course.version}"`);
    if (path === "/api/v1/courses/course-1/members/instructor-1")
      return send(
        emailPrefs
          ? { ...own, version: ownVersion, emailPreferences: preferences }
          : own,
        200,
        emailPrefs
          ? `"m:550e8400-e29b-41d4-a716-446655440002:v${ownVersion}"`
          : '"v1"',
      );
    if (
      path === "/api/v1/courses/course-1/members/me/email-preferences" &&
      method === "PATCH"
    ) {
      expect(request.headers()["if-match"]).toBe(
        `"m:550e8400-e29b-41d4-a716-446655440002:v${ownVersion}"`,
      );
      preferences = { ...preferences, ...request.postDataJSON() };
      ownVersion += 1;
      return send(
        preferences,
        200,
        `"m:550e8400-e29b-41d4-a716-446655440002:v${ownVersion}"`,
      );
    }
    if (path === "/api/v1/courses/course-1/members/student-1") {
      if (method === "DELETE") {
        deletes.push("member");
        if (staleMember && deletes.length === 1) {
          member = {
            ...student,
            user: { ...student.user, displayName: "Grace Murray Hopper" },
          };
          memberEtag = '"m:550e8400-e29b-41d4-a716-446655440001:v1"';
          members = [own, member];
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Member changed" },
            },
          });
        }
        expect(request.headers()["if-match"]).toBe(memberEtag);
        members = [own];
        return route.fulfill({ status: 204, body: "" });
      }
      return send(member, 200, memberEtag);
    }
    if (path === "/api/v1/courses/course-1/members")
      return route.fulfill({
        json: { data: members, page: { hasMore: false, nextCursor: null } },
      });
    if (path === "/api/v1/courses")
      return route.fulfill({
        json: { data: [course], page: { hasMore: false, nextCursor: null } },
      });
    if (path.endsWith("/notifications/count")) return send({ unread: 0 });
    if (path.endsWith("/notifications"))
      return route.fulfill({
        json: { data: [], page: { hasMore: false, nextCursor: null } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Not found" } },
    });
  });
  await page.goto(`${origin}/courses/course-1/settings`);
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  return { deletes };
}

test("member removal requires confirmation and Cancel preserves membership", async ({
  page,
}) => {
  const { deletes } = await openSettings(page);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove member" });
  await expect(dialog).toContainText("Grace Hopper");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "remove-member-dialog.png"),
  });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(deletes).toEqual([]);
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove member" }).click();
  await expect(page.getByText("Grace Hopper")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Members" })).toBeFocused();
  expect(deletes).toEqual(["member"]);
  await page.screenshot({ path: resolve(screenshots, "member-removed.png") });
});

test("a rejoined member requires fresh confirmation before removal", async ({
  page,
}) => {
  const { deletes } = await openSettings(page, { staleMember: true });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove member" });
  await expect(dialog).toContainText("Grace Hopper");
  await dialog.getByRole("button", { name: "Remove member" }).click();
  await expect(dialog).toHaveCount(0);
  expect(deletes).toEqual(["member"]);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(dialog).toContainText("Grace Murray Hopper");
  await page.screenshot({
    path: resolve(screenshots, "rejoined-member-reconfirmation.png"),
  });
  await dialog.getByRole("button", { name: "Remove member" }).click();
  await expect(dialog).toHaveCount(0);
  expect(deletes).toEqual(["member", "member"]);
});

test("course email switches preserve opaque membership ETags across saves", async ({
  page,
}) => {
  await openSettings(page, { emailPrefs: true });
  await page.getByRole("checkbox", { name: "Daily digest emails" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Daily digest emails" }),
  ).not.toBeChecked();
  await expect(page.getByText("Email preference saved")).toBeVisible();
  await page.getByRole("checkbox", { name: "Announcement emails" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Announcement emails" }),
  ).not.toBeChecked();
  await page.screenshot({
    path: resolve(screenshots, "course-email-preferences.png"),
  });
});

test("course deletion requires confirmation and Escape cancels it", async ({
  page,
}) => {
  const { deletes } = await openSettings(page);
  await page
    .getByRole("button", { name: "Delete course", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete course" });
  await expect(dialog).toContainText("Linear Algebra");
  await page.screenshot({
    path: resolve(screenshots, "delete-course-dialog.png"),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(deletes).toEqual([]);
  await page
    .getByRole("button", { name: "Delete course", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete course permanently" })
    .click();
  await expect(page.getByText(/This course is being deleted/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Linear Algebra", level: 1 }),
  ).toBeFocused();
  expect(deletes).toEqual(["course"]);
  await page.screenshot({ path: resolve(screenshots, "course-deleting.png") });
});

test("a stale course deletion refreshes and requires another confirmation", async ({
  page,
}) => {
  const { deletes } = await openSettings(page, { staleCourse: true });
  const trigger = page.getByRole("button", {
    name: "Delete course",
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "Delete course permanently",
    })
    .click();
  await expect(page.getByRole("alert")).toContainText("refreshed");
  await expect(
    page.getByRole("heading", { name: "Advanced Linear Algebra" }),
  ).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "stale-course-retry.png"),
  });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Advanced Linear Algebra",
  );
  expect(deletes).toEqual(["course"]);
});

test("pending course deletion traps focus until successful completion", async ({
  page,
}) => {
  await openSettings(page);
  let releaseDelete;
  const delayedDelete = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  await page.route("**/api/v1/courses/course-1", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await delayedDelete;
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { ETag: '"v2"' },
      body: JSON.stringify({
        data: { ...baseCourse, status: "deleting", version: 2 },
      }),
    });
  });
  await page
    .getByRole("button", { name: "Delete course", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Delete course" });
  await dialog
    .getByRole("button", { name: "Delete course permanently" })
    .click();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "pending-course-deletion.png"),
  });
  releaseDelete();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Linear Algebra", level: 1 }),
  ).toBeFocused();
});

test("pending member removal traps focus and recovers after failure", async ({
  page,
}) => {
  await openSettings(page);
  let releaseDelete;
  const delayedDelete = new Promise((resolve) => {
    releaseDelete = resolve;
  });
  await page.route(
    "**/api/v1/courses/course-1/members/student-1",
    async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      await delayedDelete;
      return route.fulfill({
        status: 503,
        json: { error: { code: "unavailable", message: "Try again later" } },
      });
    },
  );
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remove member" });
  await dialog.getByRole("button", { name: "Remove member" }).click();
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "pending-member-removal.png"),
  });
  releaseDelete();
  await expect(dialog.getByRole("alert")).toContainText("Try again later");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.screenshot({
    path: resolve(screenshots, "failed-member-removal.png"),
  });
});
