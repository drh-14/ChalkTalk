import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";
// Local development may load a localhost certificate while tests bind to 127.0.0.1.
test.use({ ignoreHTTPSErrors: true });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  evidence = resolve(root, "docs/pr-screenshots/resource-text-search");
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
test.afterAll(async () => await vite?.close());

const sections = [
  {
    id: "lectures",
    courseId: "course-1",
    title: "Lecture slides",
    visibility: "class",
    position: 0,
    version: 1,
  },
];
const file = (id, title, textStatus, sectionId = "lectures") => ({
  id,
  courseId: "course-1",
  kind: "upload",
  title,
  fileId: `${id}-file`,
  fileName: `${id}.pdf`,
  mediaType: "application/pdf",
  sizeBytes: 48213,
  textStatus,
  sectionId,
  visibility: "class",
  position: 0,
  version: 1,
  createdAt: "2026-10-31T12:00:00Z",
});
const catalog = [
  file("week7", "Week 7: Spectral theorem", "ready"),
  file("scan", "Scanned problem set", "failed"),
  file("handout", "Office hours handout", "pending", null),
];
const snippet = (text, word) => ({
  text,
  highlights: [...text.matchAll(new RegExp(word, "gi"))].map((m) => ({
    start: m.index,
    length: m[0].length,
  })),
});
const searchResults = {
  eigenvalue: [
    {
      resource: catalog[0],
      match: {
        inTitle: false,
        snippet: snippet(
          "…we show that the eigenvalues of a real symmetric matrix are real and its eigenvectors can be chosen orthonormal…",
          "eigenvalues",
        ),
      },
    },
    {
      resource: file("hw4", "Homework 4", "ready", null),
      match: {
        inTitle: false,
        snippet: snippet(
          "Problem 2. Find the eigenvalues of <A> = [[2, 1], [1, 2]].",
          "eigenvalues",
        ),
      },
    },
  ],
};

async function open(page, { role = "student" } = {}) {
  const searches = [];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const reply = (body, code = 200) =>
      route.fulfill({
        status: code,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/v1/sessions/current")
      return reply({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Maya Chen",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === "/api/v1/courses/course-1/members/user-1")
      return reply({ data: { role } });
    if (path === "/api/v1/courses/course-1")
      return reply({
        data: { id: "course-1", name: "Linear Algebra", status: "active" },
      });
    if (path === "/api/v1/courses/course-1/resource-sections")
      return reply({ data: sections, version: 1 });
    if (path === "/api/v1/courses/course-1/resources/search") {
      const q = url.searchParams.get("q");
      searches.push(q);
      return reply({
        data: searchResults[q] ?? [],
        page: { hasMore: false, nextCursor: null },
      });
    }
    if (path === "/api/v1/courses/course-1/resources")
      return reply({
        data: catalog,
        page: { hasMore: false, nextCursor: null },
        version: 1,
      });
    return reply({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  await page.goto(`${origin}/courses/course-1/resources`);
  await expect(
    page.getByRole("heading", { name: "Course resources", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loading course resources…")).toHaveCount(0);
  return searches;
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });

test("student finds a lecture by words inside its slides", async ({ page }) => {
  const searches = await open(page);
  await page
    .getByRole("searchbox", { name: "Search resources" })
    .fill("eigenvalue");
  const results = page.getByRole("region", { name: "Search results" });
  await expect(
    results.getByRole("link", { name: "Week 7: Spectral theorem" }),
  ).toHaveAttribute(
    "href",
    "/api/v1/courses/course-1/files/week7-file/download",
  );
  await expect(results.getByText("Lecture slides")).toBeVisible();
  await expect(results.getByText("Ungrouped")).toBeVisible();
  await expect(results.locator("mark")).toHaveText([
    "eigenvalues",
    "eigenvalues",
  ]);
  await expect(results.getByText(/<A> = \[\[2, 1\]/)).toBeVisible();
  await expect(page.locator(".resource-snippet *:not(mark)")).toHaveCount(0);
  expect(searches).toEqual(["eigenvalue"]);
  await expect(page.locator(".resource-text-status")).toHaveCount(0);
  await shot(page, "student-content-search");

  await page.getByRole("searchbox", { name: "Search resources" }).fill("");
  await expect(
    page.getByRole("heading", { name: "Lecture slides" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Search results" }),
  ).toHaveCount(0);
});

test("search with no matches keeps the query editable", async ({ page }) => {
  await open(page);
  const box = page.getByRole("searchbox", { name: "Search resources" });
  await box.fill("topology");
  await expect(page.getByText("No resources match “topology”.")).toBeVisible();
  await expect(box).toHaveValue("topology");
  await expect(box).toBeEditable();
  await shot(page, "no-results");
});

test("instructor sees which files are not searchable yet", async ({ page }) => {
  await open(page, { role: "instructor" });
  await expect(
    page.getByText("Contents could not be read for search"),
  ).toBeVisible();
  await expect(page.getByText("Contents not searchable yet")).toBeVisible();
  await expect(page.locator(".resource-text-status")).toHaveCount(2);
  await shot(page, "instructor-text-status");
});

test("instructor keeps open edits across a search", async ({ page }) => {
  await open(page, { role: "instructor" });
  await page
    .getByRole("button", { name: "Edit section Lecture slides" })
    .click();
  const sectionName = page.getByRole("textbox", { name: "Section name" });
  await sectionName.fill("Slides and notes");
  await page
    .getByRole("button", { name: "Edit Week 7: Spectral theorem" })
    .click();
  const resourceTitle = page.getByRole("textbox", { name: "Resource title" });
  await resourceTitle.fill("Week 7 revised");
  const replacement = page.getByLabel("Replacement file");
  await replacement.setInputFiles({
    name: "revised.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7"),
  });

  const box = page.getByRole("searchbox", { name: "Search resources" });
  await box.fill("eigenvalue");
  const results = page.getByRole("region", { name: "Search results" });
  const lecture = results.getByRole("link", {
    name: "Week 7: Spectral theorem",
  });
  await expect(lecture).toBeVisible();
  await expect(page.locator('form[aria-label="Edit section"]')).toBeHidden();
  await expect(page.locator('form[aria-label="Edit resource"]')).toBeHidden();
  await expect(sectionName).toHaveCount(0);
  await expect(resourceTitle).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save section" })).toHaveCount(
    0,
  );
  await box.focus();
  await page.keyboard.press("Tab");
  await expect(lecture).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(results.getByRole("link", { name: "Homework 4" })).toBeFocused();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      globalThis.document.activeElement?.closest(".organized-resources"),
    ),
  ).toBeNull();

  await box.fill("");
  await expect(sectionName).toHaveValue("Slides and notes");
  await expect(resourceTitle).toHaveValue("Week 7 revised");
  expect(await replacement.evaluate((input) => input.files[0].name)).toBe(
    "revised.pdf",
  );
  await shot(page, "instructor-edits-kept");
});

test("student sees no extraction status on the same files", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("link", { name: "Scanned problem set" }),
  ).toBeVisible();
  await expect(page.locator(".resource-text-status")).toHaveCount(0);
  await shot(page, "student-no-status");
});

test("search results fit a mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { role: "ta" });
  await page
    .getByRole("searchbox", { name: "Search resources" })
    .fill("eigenvalue");
  await expect(
    page.getByRole("link", { name: "Week 7: Spectral theorem" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await shot(page, "mobile-results");
});
