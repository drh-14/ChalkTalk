import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  evidence = resolve(root, "docs/pr-screenshots/organized-resources");
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
async function open(
  page,
  { role = "instructor", status = "active", empty = false, fail = false } = {},
) {
  let version = 1;
  let sections = empty
    ? []
    : [
        {
          id: "readings",
          courseId: "course-1",
          title: "Lecture readings",
          visibility: "class",
          position: 0,
          version: 1,
        },
        {
          id: "staff",
          courseId: "course-1",
          title: "Staff materials",
          visibility: "staff",
          position: 1,
          version: 1,
        },
      ];
  let items = empty
    ? []
    : [
        {
          id: "general",
          courseId: "course-1",
          kind: "link",
          title: "Course handbook",
          url: "https://example.edu/course",
          sectionId: null,
          visibility: "class",
          position: 0,
          version: 1,
          createdAt: "2026-10-21T10:00:00Z",
        },
        {
          id: "notes",
          courseId: "course-1",
          kind: "upload",
          title: "Week one lecture notes",
          fileId: "notes-file",
          fileName: "Lecture notes.pdf",
          mediaType: "application/pdf",
          sizeBytes: 2048,
          sectionId: "readings",
          visibility: "class",
          position: 0,
          version: 1,
          createdAt: "2026-10-21T11:00:00Z",
        },
        {
          id: "solutions",
          courseId: "course-1",
          kind: "upload",
          title: "Grading guide",
          fileId: "private-file",
          fileName: "Grading.pdf",
          mediaType: "application/pdf",
          sizeBytes: 1024,
          sectionId: "staff",
          visibility: "class",
          position: 0,
          version: 1,
          createdAt: "2026-10-21T12:00:00Z",
        },
      ];
  const requests = [];
  const visible = (r) =>
    role !== "student" ||
    (r.visibility === "class" &&
      sections.find((s) => s.id === r.sectionId)?.visibility !== "staff");
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const reply = (body, code = 200) =>
      route.fulfill({
        status: code,
        contentType: "application/json",
        body: code === 204 ? "" : JSON.stringify(body),
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
      return reply({ data: { id: "course-1", name: "Calculus I", status } });
    if (
      path === "/api/v1/courses/course-1/resource-sections" &&
      req.method() === "GET"
    )
      return reply({
        data: sections.filter(
          (s) => role !== "student" || s.visibility === "class",
        ),
        version,
      });
    if (
      path === "/api/v1/courses/course-1/resources" &&
      req.method() === "GET"
    ) {
      let rows = items.filter(visible);
      if (url.searchParams.get("sort") === "title")
        rows = rows.toSorted((a, b) => a.title.localeCompare(b.title));
      return reply({
        data: rows,
        page: { hasMore: false, nextCursor: null },
        version,
      });
    }
    if (
      path === "/api/v1/courses/course-1/resource-sections" &&
      req.method() === "POST"
    ) {
      requests.push(req);
      const s = {
        ...req.postDataJSON(),
        id: `section-${sections.length}`,
        courseId: "course-1",
        position: sections.length,
        version: 1,
      };
      sections.push(s);
      version++;
      return reply({ data: s }, 201);
    }
    if (
      path.endsWith("/resource-sections/order") ||
      path.endsWith("/resources/order")
    ) {
      requests.push(req);
      version++;
      return reply({ data: { version } });
    }
    if (
      path === "/api/v1/courses/course-1/resources" &&
      req.method() === "POST"
    ) {
      requests.push(req);
      const r = {
        ...req.postDataJSON(),
        id: `link-${items.length}`,
        courseId: "course-1",
        position: items.length,
        version: 1,
        createdAt: "2026-10-21T12:00:00Z",
      };
      items.push(r);
      version++;
      return reply({ data: r }, 201);
    }
    if (
      (path.endsWith("/resources/files") && req.method() === "POST") ||
      (path.match(/\/resources\/[^/]+\/file$/) && req.method() === "PUT")
    ) {
      requests.push(req);
      const existing = items.find((r) => r.id === path.split("/").at(-2));
      const r = {
        ...(existing ?? {}),
        id: existing?.id ?? `file-${items.length}`,
        courseId: "course-1",
        title: existing?.title ?? "Uploaded resource",
        fileId: "new-file",
        fileName: "New notes.txt",
        kind: "upload",
        sectionId: existing?.sectionId ?? null,
        visibility: existing?.visibility ?? "class",
        position: existing?.position ?? 0,
        version: (existing?.version ?? 0) + 1,
        createdAt: "2026-10-21T12:00:00Z",
      };
      items = existing
        ? items.map((i) => (i.id === existing.id ? r : i))
        : [...items, r];
      version++;
      return reply({ data: r }, existing ? 200 : 201);
    }
    if (path.match(/\/resources\/[^/]+$/) && req.method() === "PATCH") {
      requests.push(req);
      if (fail)
        return reply(
          {
            error: {
              code: "version_conflict",
              message: "Resource changed. Your draft is preserved.",
            },
          },
          412,
        );
      const id = path.split("/").at(-1);
      items = items.map((r) =>
        r.id === id
          ? { ...r, ...req.postDataJSON(), version: r.version + 1 }
          : r,
      );
      version++;
      return reply({ data: items.find((r) => r.id === id) });
    }
    if (path.match(/\/resources\/[^/]+$/) && req.method() === "DELETE") {
      requests.push(req);
      items = items.filter((r) => r.id !== path.split("/").at(-1));
      version++;
      return reply({}, 204);
    }
    if (path.match(/\/resource-sections\/[^/]+$/) && req.method() === "PATCH") {
      requests.push(req);
      const id = path.split("/").at(-1);
      sections = sections.map((s) =>
        s.id === id
          ? { ...s, ...req.postDataJSON(), version: s.version + 1 }
          : s,
      );
      version++;
      return reply({ data: sections.find((s) => s.id === id) });
    }
    return reply({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  await page.goto(`${origin}/courses/course-1/resources`);
  await expect(
    page.getByRole("heading", { name: "Course resources", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Loading course resources…")).toHaveCount(0);
  return requests;
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
test("instructor creates only custom sections and adds a resource", async ({
  page,
}) => {
  const requests = await open(page, { empty: true });
  await expect(page.getByText("No course resources yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Homework" })).toHaveCount(0);
  await shot(page, "instructor-zero-sections");
  await page
    .getByRole("textbox", { name: "Section title", exact: true })
    .fill("Exam preparation");
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Exam preparation", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Link title", { exact: true })
    .fill("Practice problems");
  await page
    .getByLabel("Link URL", { exact: true })
    .fill("https://example.edu/practice");
  await page
    .getByLabel("Link section", { exact: true })
    .selectOption("section-0");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Practice problems" }),
  ).toBeVisible();
  expect(requests[0].headers()["x-csrf-token"]).toBe("csrf");
  await shot(page, "custom-section-link");
});
test("student sees grouped public and ungrouped resources but no staff section or controls", async ({
  page,
}) => {
  await open(page, { role: "student" });
  await expect(
    page.getByRole("heading", { name: "Lecture readings" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ungrouped" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Week one lecture notes" }),
  ).toHaveAttribute(
    "href",
    "/api/v1/courses/course-1/files/notes-file/download",
  );
  await expect(page.getByText("Staff materials", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: "Grading guide" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(
    0,
  );
  await shot(page, "student-public-only");
});
test("instructor moves and renames a resource with conditional save", async ({
  page,
}) => {
  const requests = await open(page);
  await page
    .getByRole("button", { name: "Edit Week one lecture notes", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Edit resource" });
  await form
    .getByLabel("Resource title", { exact: true })
    .fill("Revised lecture handout");
  await form.getByLabel("Resource section", { exact: true }).selectOption("");
  await form.getByRole("button", { name: "Save resource" }).click();
  await expect(
    page
      .getByRole("region", { name: "Ungrouped" })
      .getByRole("link", { name: "Revised lecture handout" }),
  ).toBeVisible();
  expect(
    requests.find((r) => r.method() === "PATCH").headers()["if-match"],
  ).toBe('"v1"');
  await shot(page, "resource-renamed-moved");
});
test("instructor replaces a file and removes a resource", async ({ page }) => {
  await open(page);
  await page
    .getByRole("button", { name: "Edit Week one lecture notes", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Edit resource" });
  await form.getByLabel("Replacement file").setInputFiles({
    name: "New notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("New notes"),
  });
  await form.getByRole("button", { name: "Save resource" }).click();
  await expect(
    page.getByRole("link", { name: "Week one lecture notes" }),
  ).toHaveAttribute("href", "/api/v1/courses/course-1/files/new-file/download");
  await shot(page, "file-replaced");
  await page
    .getByRole("button", { name: "Remove Week one lecture notes", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm remove resource" }).click();
  await expect(
    page.getByRole("link", { name: "Week one lecture notes" }),
  ).toHaveCount(0);
  await shot(page, "resource-removed");
});
test("failed replacement retries keep the key until metadata changes", async ({
  page,
}) => {
  await open(page);
  const keys = [];
  await page.route(
    "**/api/v1/courses/course-1/resources/notes/file",
    async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Storage unavailable" } }),
      });
    },
  );
  await page
    .getByRole("button", { name: "Edit Week one lecture notes", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Edit resource" });
  await form.getByLabel("Replacement file").setInputFiles({
    name: "Replacement.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("new bytes"),
  });
  const save = form.getByRole("button", { name: "Save resource" });
  await save.click();
  await expect(form.getByRole("alert")).toContainText("Storage unavailable");
  await save.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  await form
    .getByLabel("Resource title", { exact: true })
    .fill("Revised title");
  await save.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[1]);
  await expect(form.getByLabel("Resource title", { exact: true })).toHaveValue(
    "Revised title",
  );
  await shot(page, "replacement-retry-draft");
});
test("stale save keeps metadata draft for explicit review", async ({
  page,
}) => {
  await open(page, { fail: true });
  await page
    .getByRole("button", { name: "Edit Course handbook", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Edit resource" });
  await form
    .getByLabel("Resource title", { exact: true })
    .fill("Unsaved handbook title");
  await form.getByRole("button", { name: "Save resource" }).click();
  await expect(form.getByRole("alert")).toContainText("draft is preserved");
  await expect(form.getByLabel("Resource title", { exact: true })).toHaveValue(
    "Unsaved handbook title",
  );
  await shot(page, "stale-draft");
});
test("mobile TA sees staff materials while archived course remains download-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { role: "ta", status: "archived" });
  await expect(
    page.getByRole("heading", { name: "Staff materials" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Grading guide" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add section" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await shot(page, "mobile-archived-staff");
});
