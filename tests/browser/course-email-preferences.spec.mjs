import process from "node:process";
import { URL } from "node:url";

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/course-email-preferences");
mkdirSync(screenshots, { recursive: true });
const now = "2026-10-21T00:00:00Z";
const course = {
  id: "fixture-course",
  organizationId: "fixture-org",
  name: "Physics",
  status: "active",
  joinCode: null,
  createdAt: now,
  updatedAt: now,
  version: 1,
};
const member = (version, choices) => ({
  id: "fixture-member",
  courseId: course.id,
  user: { id: "fixture-user", displayName: "Sam Student" },
  role: "student",
  emailPreferences: choices,
  createdAt: now,
  updatedAt: now,
  version,
});
const initial = {
  activityEmails: false,
  announcementEmails: true,
  digestEmails: true,
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
test.afterAll(async () => {
  await vite?.close();
});

async function open(browser, conflict = false) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let version = 1;
  let choices = { ...initial };
  const patches = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const fulfill = (data, status = 200, etag = '"v1"') =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { ETag: etag },
        body: JSON.stringify({ data }),
      });
    if (path === "/api/v1/courses/fixture-course" && req.method() === "GET")
      return fulfill(course);
    if (
      path === "/api/v1/courses/fixture-course/members/fixture-user" &&
      req.method() === "GET"
    )
      return fulfill(member(version, choices), 200, `"v${version}"`);
    if (
      path === "/api/v1/courses/fixture-course/members" &&
      req.method() === "GET"
    )
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [member(version, choices)],
          page: { nextCursor: null, hasMore: false },
        }),
      });
    if (
      path === "/api/v1/courses/fixture-course/members/me/email-preferences" &&
      req.method() === "PATCH"
    ) {
      patches.push({
        body: req.postDataJSON(),
        etag: req.headers()["if-match"],
      });
      if (conflict) {
        version = 2;
        choices = { ...choices, announcementEmails: false };
        return route.fulfill({
          status: 412,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "version_conflict",
              message: "Membership has changed",
            },
          }),
        });
      }
      version += 1;
      choices = { ...choices, ...req.postDataJSON() };
      return fulfill(choices, 200, `"v${version}"`);
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(`${origin}/course-email-fixture.html`);
  await expect(
    page.getByRole("heading", { name: "Email notifications" }),
  ).toBeVisible();
  return { context, page, patches };
}

test("saves one course email category without changing the others", async ({
  browser,
}) => {
  const { context, page, patches } = await open(browser);
  await page.getByRole("checkbox", { name: "Daily digest emails" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Email preference saved",
  );
  await expect(
    page.getByRole("checkbox", { name: "Announcement emails" }),
  ).toBeChecked();
  expect(patches).toEqual([{ body: { digestEmails: false }, etag: '"v1"' }]);
  await page.screenshot({
    path: resolve(screenshots, "digest-off.png"),
    fullPage: true,
  });
  await context.close();
});

test("stale save refreshes choices and explains the conflict", async ({
  browser,
}) => {
  const { context, page } = await open(browser, true);
  await page.getByRole("checkbox", { name: "Daily digest emails" }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(
    page.getByRole("checkbox", { name: "Daily digest emails" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Announcement emails" }),
  ).not.toBeChecked();
  await page.screenshot({
    path: resolve(screenshots, "conflict.png"),
    fullPage: true,
  });
  await context.close();
});

test("account settings loads every course and saves per-course choices", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const patches = [];
  const preferences = { ...initial };
  const second = { ...course, id: "fixture-course-2", name: "Chemistry" };
  await page.route("**/api/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fulfill = (data, etag = '"v1"') =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: etag },
        body: JSON.stringify({ data }),
      });
    if (url.pathname === "/api/v1/users/me")
      return fulfill({
        id: "fixture-user",
        email: "sam@example.edu",
        displayName: "Sam Student",
        version: 1,
      });
    if (url.pathname === "/api/v1/courses")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: url.searchParams.has("cursor") ? [second] : [course],
          page: {
            nextCursor: url.searchParams.has("cursor") ? null : "next",
            hasMore: !url.searchParams.has("cursor"),
          },
        }),
      });
    if (url.pathname.endsWith("/email-preferences")) {
      if (request.method() === "PATCH") {
        patches.push({
          course: url.pathname,
          body: request.postDataJSON(),
          etag: request.headers()["if-match"],
        });
        return fulfill({ ...preferences, ...request.postDataJSON() }, '"v2"');
      }
      return fulfill(preferences);
    }
    return route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(`${origin}/account-email-fixture.html`);
  const physics = page.getByRole("group", { name: "Physics" });
  const chemistry = page.getByRole("group", { name: "Chemistry" });
  await expect(
    physics.getByRole("checkbox", { name: "Daily digest emails" }),
  ).toBeChecked();
  await expect(
    chemistry.getByRole("checkbox", { name: "Daily digest emails" }),
  ).toBeChecked();
  await physics
    .getByRole("checkbox", { name: "Activity emails on followed posts" })
    .click();
  await expect(physics.getByRole("status")).toContainText(
    "Email preference saved",
  );
  await expect(
    chemistry.getByRole("checkbox", {
      name: "Activity emails on followed posts",
    }),
  ).not.toBeChecked();
  expect(patches).toEqual([
    {
      course: "/api/v1/courses/fixture-course/members/me/email-preferences",
      body: { activityEmails: true },
      etag: '"v1"',
    },
  ]);
  await page.screenshot({
    path: resolve(screenshots, "account-courses.png"),
    fullPage: true,
  });
  await context.close();
});
