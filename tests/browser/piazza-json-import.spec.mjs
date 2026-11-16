import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let vite, origin;
test.beforeAll(async () => {
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => await vite?.close());

const source = {
  network: {
    id: "piazza-1",
    name: "Software Engineering",
    courseNumber: "CSE 416",
  },
  selfUid: null,
  users: [{ id: "student-1", name: "Sam Student", role: "student" }],
  posts: [
    {
      id: "post-1",
      type: "question",
      status: "active",
      created: "2026-01-01T00:00:00Z",
      history: [
        {
          uid: "student-1",
          subject: "Public question",
          content: "Body",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    },
    {
      id: "post-2",
      type: "question",
      status: "private",
      created: "2026-01-01T00:00:00Z",
      history: [
        {
          uid: "student-1",
          subject: "Private question",
          content: "Secret",
          created: "2026-01-01T00:00:00Z",
        },
      ],
    },
  ],
};
async function mockApp(page, failImport = false) {
  const uploads = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/v1/sessions/current")
      return reply({
        data: {
          id: "session",
          user: {
            id: "user-1",
            email: "owner@example.edu",
            displayName: "Owner",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/courses" && request.method() === "GET")
      return reply({ data: [], page: { nextCursor: null, hasMore: false } });
    if (path === "/api/v1/piazza-imports") {
      uploads.push(request);
      return failImport
        ? reply(
            {
              error: {
                code: "validation_failed",
                message: "This is not a supported ChalkTalk Piazza JSON export",
              },
            },
            422,
          )
        : reply({
            data: {
              courseId: "imported-course",
              courseName: "CSE 416 Software Engineering",
              omittedPrivatePosts: 1,
              posts: { created: 1, updated: 0, skipped: 0 },
              answers: { created: 0, updated: 0, skipped: 0 },
              followups: { created: 0, updated: 0, skipped: 0 },
            },
          });
    }
    if (path === "/api/v1/courses/imported-course")
      return reply({
        data: {
          id: "imported-course",
          name: "CSE 416 Software Engineering",
          status: "active",
        },
      });
    if (path === "/api/v1/courses/imported-course/members/user-1")
      return reply({ data: { role: "instructor" } });
    if (path === "/api/v1/courses/imported-course/posts")
      return reply({
        data: [
          {
            id: "imported-post",
            courseId: "imported-course",
            type: "question",
            title: "Public question",
            bodyMarkdown: "Body",
            author: {
              userId: "imported-student",
              displayName: "Sam Student",
              anonymous: false,
              deleted: false,
            },
            anonymous: false,
            private: false,
            pinned: false,
            deleted: false,
            tags: [],
            createdAt: "2026-01-01T00:00:00Z",
            lastActivityAt: "2026-01-01T00:00:00Z",
            version: 1,
          },
        ],
        page: { nextCursor: null, hasMore: false },
      });
    if (path === "/api/v1/courses/imported-course/threads/unread-count")
      return reply({ data: { unreadCount: 0 } });
    return reply({ data: [], page: { nextCursor: null, hasMore: false } });
  });
  return uploads;
}
const file = (content) => ({
  name: "class.json",
  mimeType: "application/json",
  buffer: Buffer.from(content),
});

test("previews public-only import, requires consent, and opens the imported course", async ({
  page,
}, testInfo) => {
  const uploads = await mockApp(page);
  await page.goto(origin);
  await page.getByRole("button", { name: "Import Piazza course" }).click();
  await page
    .getByLabel("Piazza JSON file")
    .setInputFiles(file(JSON.stringify(source)));
  await expect(page.getByText("1 private post will be omitted")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import course" }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("preview.png"),
    fullPage: true,
  });
  await page.getByRole("checkbox", { name: /authorized to migrate/ }).check();
  await page.getByRole("button", { name: "Import course" }).click();
  await expect(page).toHaveURL(/\/courses\/imported-course$/);
  await expect(page.getByText("Public question")).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].headers()["x-csrf-token"]).toBe("csrf");
  await page.screenshot({
    path: testInfo.outputPath("imported-course.png"),
    fullPage: true,
  });
});

test("invalid local JSON and server rejection remain recoverable", async ({
  page,
}, testInfo) => {
  const uploads = await mockApp(page, true);
  await page.goto(origin);
  await page.getByRole("button", { name: "Import Piazza course" }).click();
  await page.getByLabel("Piazza JSON file").setInputFiles(file("not JSON"));
  await expect(page.getByRole("alert")).toContainText("valid JSON");
  expect(uploads).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("invalid-file.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Piazza JSON file")
    .setInputFiles(file(JSON.stringify(source)));
  await page.getByRole("checkbox", { name: /authorized to migrate/ }).check();
  await page.getByRole("button", { name: "Import course" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "not a supported ChalkTalk Piazza JSON export",
  );
  await expect(
    page.getByRole("button", { name: "Import course" }),
  ).toBeEnabled();
  expect(uploads).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath("server-rejected.png"),
    fullPage: true,
  });
});
