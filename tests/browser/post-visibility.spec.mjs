import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const screenshots = resolve(root, "docs/pr-screenshots/post-visibility");
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

test("Public and Private creation stay explicit, and polls cannot be private", async ({
  page,
}) => {
  const requests = [];
  let created;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (data, status = 200) =>
      route.fulfill({ status, json: { data } });
    if (path.endsWith("/members/u1")) return json({ role: "ta" });
    if (path.endsWith("/posts") && request.method() === "GET")
      return route.fulfill({
        json: { data: [], page: { nextCursor: null, hasMore: false } },
      });
    if (path.endsWith("/posts") && request.method() === "POST") {
      const input = request.postDataJSON();
      requests.push(input);
      created = {
        ...input,
        id: `post-${requests.length}`,
        courseId: "course-1",
        author: {
          userId: "u1",
          displayName: "Ada",
          anonymous: false,
          deleted: false,
        },
        deleted: false,
        private: input.private ?? false,
        attachments: [],
        createdAt: "2026-10-25T00:00:00Z",
        lastActivityAt: "2026-10-25T00:00:00Z",
        version: 1,
      };
      return json(created, 201);
    }
    if (path === `/api/v1/posts/${created?.id}`) return json(created);
    if (path.endsWith("/answers")) return json([]);
    if (path.endsWith("/followups"))
      return route.fulfill({
        json: { data: [], meta: { total: 0, nextCursor: null } },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: "not_found", message: "Fixture route missing" } },
    });
  });
  await page.goto(`${origin}/attachments-fixture.html`);
  await page.getByRole("button", { name: "Create post" }).click();
  const visibility = page.getByRole("combobox", { name: "Visibility" });
  await expect(visibility).toHaveValue("course");
  await visibility.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshots, "public-composer.png"),
    fullPage: true,
  });

  await visibility.selectOption("staff");
  await expect(
    page.getByRole("option", {
      name: "Private — only you and current instructors/TAs",
    }),
  ).toBeAttached();
  await visibility.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(screenshots, "private-composer.png"),
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Grade question");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("Could you check the rubric?");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByText("Only you and course staff can see this."),
  ).toBeVisible();
  expect(requests[0]).toMatchObject({ type: "question", private: true });
  await page.screenshot({
    path: resolve(screenshots, "private-published.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveValue(
    "course",
  );
  await page
    .getByRole("textbox", { name: "Post title" })
    .fill("Public question");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("Can anyone explain this?");
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Public question" }),
  ).toBeVisible();
  expect(requests[1]).toMatchObject({ type: "question" });
  expect(requests[1]).not.toHaveProperty("private");
  await page.screenshot({
    path: resolve(screenshots, "public-published.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("combobox", { name: "Post type" }).selectOption("poll");
  await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: resolve(screenshots, "public-only-poll.png"),
    fullPage: true,
  });

  await page.getByRole("combobox", { name: "Post type" }).selectOption("note");
  const announcement = page.getByRole("checkbox", {
    name: "Post as announcement (pinned; email sent to subscribers)",
  });
  await announcement.check();
  await page
    .getByRole("combobox", { name: "Visibility" })
    .selectOption("staff");
  await expect(announcement).toBeDisabled();
  await expect(announcement).not.toBeChecked();
  await page
    .getByRole("combobox", { name: "Visibility" })
    .selectOption("course");
  await announcement.check();
  await page.getByRole("textbox", { name: "Post title" }).fill("Class update");
  await page
    .getByRole("textbox", { name: "Post body" })
    .fill("Lab is tomorrow.");
  await page.screenshot({
    path: resolve(screenshots, "public-only-announcement.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    page.getByRole("heading", { name: "Class update" }),
  ).toBeVisible();
  expect(requests[2]).toMatchObject({ type: "note", announcement: true });
  expect(requests[2]).not.toHaveProperty("private");
});
