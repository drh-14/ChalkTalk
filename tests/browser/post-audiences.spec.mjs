import { mkdirSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/post-audiences");
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

const person = (id, name, role) => ({
  id: `${id}-membership`,
  courseId: "course-1",
  user: { id, displayName: name },
  role,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  version: 1,
});
const members = [
  person("u1", "Student", "student"),
  person("ta-1", "First TA", "ta"),
  person("instructor-1", "Instructor", "instructor"),
];
const post = (id, title, audience, groupName) => ({
  id,
  courseId: "course-1",
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: "A private discussion",
  author: {
    userId: "u1",
    displayName: "Student",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  attachments: [],
  private: true,
  audience,
  ...(groupName ? { groupId: "group-1", groupName } : {}),
  createdAt: "2026-10-21T12:00:00Z",
  updatedAt: "2026-10-21T12:00:00Z",
  lastActivityAt: "2026-10-21T12:00:00Z",
  version: 1,
  following: true,
  unread: false,
  answered: false,
  unresolvedFollowups: 0,
});

async function mockApi(page, options = {}) {
  let created;
  const payloads = [];
  const groups = [
    {
      id: "group-1",
      name: "Lab mentors",
      joined: true,
      memberIds: ["u1", "ta-1"],
    },
    {
      id: "group-2",
      name: "Other group",
      joined: false,
      memberIds: ["instructor-1"],
    },
  ];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const json = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (path === "/api/v1/courses/course-1/members/u1")
      return json(options.staff ? person("u1", "Student", "ta") : members[0]);
    if (path === "/api/v1/courses/course-1/members")
      return route.fulfill({
        json: { data: members, page: { nextCursor: null, hasMore: false } },
      });
    if (path === "/api/v1/courses/course-1/private-groups" && method === "GET")
      return json(groups);
    if (
      path === "/api/v1/courses/course-1/private-groups" &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON();
      payloads.push(body);
      const group = {
        id: `group-${groups.length + 1}`,
        name: body.name,
        joined: body.memberIds.includes("u1"),
        memberIds: body.memberIds,
      };
      groups.push(group);
      return json(group, 201);
    }
    const groupRoute =
      /^\/api\/v1\/courses\/course-1\/private-groups\/(group-\d+)(?:\/members\/(.+))?$/i.exec(
        path,
      );
    if (groupRoute) {
      const group = groups.find((item) => item.id === groupRoute[1]);
      if (!group)
        return route.fulfill({
          status: 404,
          json: { error: { code: "not_found" } },
        });
      if (groupRoute[2]) {
        if (method === "PUT" && !group.memberIds.includes(groupRoute[2]))
          group.memberIds.push(groupRoute[2]);
        if (method === "DELETE")
          group.memberIds = group.memberIds.filter(
            (id) => id !== groupRoute[2],
          );
        group.joined = group.memberIds.includes("u1");
        return route.fulfill({ status: 204 });
      }
      if (method === "PATCH") {
        group.name = route.request().postDataJSON().name;
        return json(group);
      }
      if (method === "DELETE") {
        groups.splice(groups.indexOf(group), 1);
        return route.fulfill({ status: 204 });
      }
    }
    if (path === "/api/v1/courses/course-1/posts" && method === "GET")
      return route.fulfill({
        json: {
          data: created ? [created] : [],
          page: { nextCursor: null, hasMore: false },
        },
      });
    if (path === "/api/v1/courses/course-1/posts" && method === "POST") {
      const body = route.request().postDataJSON();
      payloads.push(body);
      if (options.rejectCreate)
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "validation_failed",
              message: "Group membership changed",
            },
          },
        });
      created = post(
        "post-1",
        body.title,
        body.audience,
        body.audience === "group" ? "Lab mentors" : undefined,
      );
      return json(created, 201);
    }
    if (path === "/api/v1/posts/post-1" && method === "GET")
      return options.hidden
        ? route.fulfill({
            status: 404,
            json: {
              error: { code: "not_found", message: "Post is not found" },
            },
          })
        : json(created ?? post("post-1", "Private topic", "selected_staff"));
    if (path.endsWith("/answers") || path.endsWith("/followups"))
      return json([]);
    if (path.endsWith("/collaboration-sessions"))
      return route.fulfill({
        json: { data: [], page: { nextCursor: null, hasMore: false } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  return payloads;
}

test("selected staff composer and detail keep the audience narrow", async ({
  page,
}) => {
  const payloads = await mockApi(page);
  await page.goto(`${origin}/attachments-fixture.html?post=`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page
    .getByRole("combobox", { name: "Post to" })
    .selectOption("selected_staff");
  await page.getByRole("checkbox", { name: "First TA" }).check();
  await page.getByRole("textbox", { name: "Post title" }).fill("Private topic");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("A private discussion");
  await page.screenshot({
    path: resolve(screenshots, "selected-staff-composer-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByText("Only you and selected current staff can see this."),
  ).toBeVisible();
  expect(payloads[0]).toMatchObject({
    audience: "selected_staff",
    staffRecipientIds: ["ta-1"],
  });
  await page.screenshot({
    path: resolve(screenshots, "selected-staff-detail-desktop.png"),
    fullPage: true,
  });
});

test("group composer shows only joined groups and preserves a rejected draft on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const payloads = await mockApi(page, { rejectCreate: true });
  await page.goto(`${origin}/attachments-fixture.html?post=`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("combobox", { name: "Post to" }).selectOption("group");
  const groups = page.getByRole("combobox", { name: "Private group" });
  await expect(groups.getByRole("option", { name: "Lab mentors" })).toHaveCount(
    1,
  );
  await expect(groups.getByRole("option", { name: "Other group" })).toHaveCount(
    0,
  );
  await groups.selectOption("group-1");
  await page.getByRole("textbox", { name: "Post title" }).fill("Lab question");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("A private discussion");
  await page.screenshot({
    path: resolve(screenshots, "group-composer-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Group membership changed",
  );
  await expect(page.getByRole("textbox", { name: "Post title" })).toHaveValue(
    "Lab question",
  );
  expect(payloads[0]).toMatchObject({ audience: "group", groupId: "group-1" });
  await page.screenshot({
    path: resolve(screenshots, "group-rejection-mobile.png"),
    fullPage: true,
  });
});

test("an unselected reader sees no restricted post", async ({ page }) => {
  await mockApi(page, { hidden: true });
  await page.goto(`${origin}/attachments-fixture.html?post=post-1`);
  await expect(
    page.getByRole("heading", { name: "Private topic" }),
  ).toHaveCount(0);
  await expect(page.locator(".post-card")).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "unselected-reader-desktop.png"),
    fullPage: true,
  });
});

test("staff can create a managed private group", async ({ page }) => {
  const payloads = await mockApi(page, { staff: true });
  await page.goto(`${origin}/attachments-fixture.html?post=`);
  await page.getByText("Manage private groups").click();
  await expect(
    page.getByRole("heading", { name: "Lab mentors" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New group name" })
    .fill("Project review");
  await page
    .getByRole("group", { name: "Initial members" })
    .getByRole("checkbox", { name: "First TA" })
    .check();
  await page.screenshot({
    path: resolve(screenshots, "group-management-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(
    page.getByRole("heading", { name: "Project review" }),
  ).toBeVisible();
  expect(payloads[0]).toMatchObject({
    name: "Project review",
    memberIds: ["ta-1"],
  });
  await page.screenshot({
    path: resolve(screenshots, "group-created-desktop.png"),
    fullPage: true,
  });
  const section = page.getByRole("region", { name: "Group Project review" });
  await section.getByRole("button", { name: "Rename" }).click();
  await section
    .getByRole("textbox", { name: "Rename group" })
    .fill("Project reviewers");
  await section.getByRole("button", { name: "Save name" }).click();
  const renamed = page.getByRole("region", { name: "Group Project reviewers" });
  await expect(
    renamed.getByRole("heading", { name: "Project reviewers" }),
  ).toBeVisible();
  await renamed
    .getByRole("group", { name: "Members of Project reviewers" })
    .getByRole("checkbox", { name: "Student" })
    .check();
  await expect(
    renamed.getByRole("checkbox", { name: "Student" }),
  ).toBeChecked();
  await page.screenshot({
    path: resolve(screenshots, "group-membership-desktop.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await renamed.getByRole("button", { name: "Delete group" }).click();
  await expect(renamed).toHaveCount(0);
  await page.screenshot({
    path: resolve(screenshots, "group-deleted-desktop.png"),
    fullPage: true,
  });
});
