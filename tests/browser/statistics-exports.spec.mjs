import { mkdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const evidence = resolve(root, "docs/pr-screenshots/statistics-exports");
let vite, origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
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

async function open(page) {
  const downloads = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const respond = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/v1/sessions/current")
      return respond({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Professor",
            email: "prof@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (url.pathname === "/api/v1/courses/course-1/members/user-1")
      return respond({ data: { role: "instructor" } });
    if (url.pathname === "/api/v1/courses/course-1")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"v1"' },
        body: JSON.stringify({
          data: { id: "course-1", name: "Physics", status: "active" },
        }),
      });
    if (url.pathname === "/api/v1/courses/course-1/statistics")
      return respond({
        data: {
          courseId: "course-1",
          period: url.searchParams.get("period"),
          dailyActivity: [
            {
              date: "2026-10-21",
              questionsCreated: 1,
              answersCreated: 0,
              postsViewed: 2,
            },
          ],
          postsViewed: 2,
          averageResponseTimeSeconds: null,
          generatedAt: "2026-10-21T12:00:00Z",
        },
      });
    if (url.pathname === "/api/v1/courses/course-1/statistics/students")
      return respond({
        data: [
          {
            user: { id: "student-1", displayName: "Ada" },
            questionsCreated: 1,
            answersContributed: 0,
            postsViewed: 0,
          },
        ],
        page: { hasMore: false, nextCursor: null },
      });
    if (url.pathname.includes("/statistics/export/")) {
      downloads.push({
        kind: url.pathname.split("/").at(-1),
        period: url.searchParams.get("period"),
      });
      if (url.pathname.endsWith("/students"))
        return respond(
          { error: { message: "Export temporarily unavailable" } },
          503,
        );
      return route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        body: "date,questions_created,answers_created,posts_viewed\r\n2026-10-21,1,0,2\r\n",
      });
    }
    if (url.pathname === "/api/v1/users/me/notifications/unread-count")
      return respond({ data: { count: 0 } });
    if (url.pathname === "/api/v1/courses")
      return respond({ data: [], page: { hasMore: false, nextCursor: null } });
    throw new Error(
      `Unexpected API ${route.request().method()} ${url.pathname}`,
    );
  });
  await page.goto(`${origin}/courses/course-1/statistics`);
  await expect(
    page.getByRole("heading", { name: "Course statistics" }),
  ).toBeVisible();
  return downloads;
}

test("selected-period CSV download and retained statistics on failure", async ({
  page,
}) => {
  const downloads = await open(page);
  await page.getByLabel("Period").selectOption("7d");
  await expect(page.getByText("Ada")).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "selected-period.png"),
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download daily activity CSV" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("chalktalk-course-1-7d-daily.csv");
  expect(await readFile(await download.path(), "utf8")).toContain(
    "2026-10-21,1,0,2",
  );
  await expect.poll(() => downloads.length).toBe(1);
  expect(downloads[0]).toEqual({ kind: "daily", period: "7d" });
  await page
    .getByRole("button", { name: "Download student roster CSV" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Export temporarily unavailable",
  );
  expect(downloads[1]).toEqual({ kind: "students", period: "7d" });
  await expect(page.getByText("Ada")).toBeVisible();
  await page.screenshot({
    path: resolve(evidence, "export-error.png"),
    fullPage: true,
  });
});
