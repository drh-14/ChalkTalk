import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(
  root,
  "test-results/browser-screenshots/resource-extracted-text",
);
let vite, origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 5188, strictPort: true },
  });
  await vite.listen();
  origin = vite.resolvedUrls.local[0].replace(/\/$/, "");
});
test.afterAll(async () => await vite?.close());
const file = (id, title) => ({
  id,
  courseId: "course-1",
  kind: "upload",
  title,
  fileId: `${id}-file`,
  fileName: `${id}.docx`,
  mediaType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 2048,
  sectionId: null,
  visibility: "class",
  position: 0,
  version: 1,
  textStatus: "ready",
  createdAt: "2026-11-04T12:00:00Z",
});
const ready = {
  fileId: "notes-file",
  status: "ready",
  text:
    '<script>alert("literal")</script>\nExtracted reading text.\n' +
    "A".repeat(300),
  truncated: false,
};
async function open(page, { role = "instructor", readText } = {}) {
  let items = [
    file("notes", "Lecture reading"),
    file("slides", "Lecture slides"),
    {
      ...file("link", "Course website"),
      kind: "link",
      url: "https://example.edu",
    },
  ];
  const orders = [],
    textRequests = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path.endsWith("/sessions/current"))
      return reply({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Maya",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path.endsWith("/members/user-1")) return reply({ data: { role } });
    if (path === "/api/v1/courses/course-1")
      return reply({
        data: { id: "course-1", name: "Test course", status: "active" },
      });
    if (path.endsWith("/resource-sections"))
      return reply({ data: [], version: 1 });
    if (path.endsWith("/text")) {
      textRequests.push(path);
      return readText
        ? readText(route, textRequests.length, reply)
        : reply({ data: ready });
    }
    if (path.endsWith("/resources/notes"))
      return reply({
        data: {
          ...items[0],
          textStatus: "pending",
          textProgress: {
            phase: "queued",
            completedPages: null,
            totalPages: null,
          },
        },
      });
    if (path.endsWith("/resources/order")) {
      const body = req.postDataJSON();
      orders.push(body);
      items = body.ids.map((id) => items.find((item) => item.id === id));
      return reply({ data: { version: 2 } });
    }
    if (path.endsWith("/resources/search"))
      return reply({
        data: [{ resource: items[0], match: { inTitle: true, snippet: null } }],
        page: { hasMore: false, nextCursor: null },
      });
    if (path.endsWith("/resources"))
      return reply({
        data: items,
        version: orders.length + 1,
        page: { hasMore: false, nextCursor: null },
      });
    return reply({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  await page.goto(`${origin}/courses/course-1/resources`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await expect(
    page.getByRole("link", { name: "Lecture reading", exact: true }),
  ).toBeVisible();
  return { orders, textRequests };
}
const card = (page) =>
  page
    .locator("li")
    .filter({
      has: page.getByRole("link", { name: "Lecture reading", exact: true }),
    })
    .first();
const panel = (page) =>
  page
    .getByRole("region", {
      name: "Extracted text for Lecture reading",
      exact: true,
    })
    .first();
const shot = (page, name) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });

test("desktop reader inspects literal text, closes, and reopens fresh data", async ({
  page,
}) => {
  const { textRequests } = await open(page, { role: "student" });
  expect(textRequests).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "View extracted text" }),
  ).toHaveCount(2);
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).locator("pre")).toHaveText(ready.text);
  await expect(panel(page).locator("script")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Move resource up" }),
  ).toHaveCount(0);
  await shot(page, "desktop-ready-literal-text");
  await panel(page)
    .getByRole("button", { name: "Close extracted text" })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await expect(
    card(page).getByRole("button", { name: "View extracted text" }),
  ).toBeFocused();
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).locator("pre")).toBeVisible();
  expect(textRequests).toHaveLength(2);
});

test("pending refresh and request failure retry recover", async ({ page }) => {
  await open(page, {
    readText: (_route, count, reply) =>
      count === 1
        ? reply({ data: { ...ready, status: "pending", text: null } })
        : count === 2
          ? reply(
              {
                error: {
                  code: "service_unavailable",
                  message: "Text is temporarily unavailable.",
                },
              },
              503,
            )
          : reply({ data: ready }),
  });
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).getByText("Queued for extraction")).toBeVisible();
  await shot(page, "pending-refresh");
  await panel(page).getByRole("button", { name: "Refresh text" }).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "Text is temporarily unavailable.",
  );
  await shot(page, "error-retry");
  await panel(page)
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await expect(panel(page).locator("pre")).toHaveText(ready.text);
});

for (const [name, data, notice] of [
  ["empty", { ...ready, text: "" }, "No text was found in this file."],
  [
    "truncated",
    { ...ready, truncated: true },
    "Only part of this file's text was extracted.",
  ],
  [
    "failed",
    { ...ready, status: "failed", text: null },
    "Text could not be extracted from this file.",
  ],
  [
    "unsupported",
    { ...ready, status: "unsupported", text: null },
    "Text extraction is not supported for this file.",
  ],
])
  test(`shows ${name} extracted text state`, async ({ page }) => {
    await open(page, { readText: (_route, _count, reply) => reply({ data }) });
    await card(page)
      .getByRole("button", { name: "View extracted text" })
      .click();
    await expect(panel(page).getByText(notice, { exact: true })).toBeVisible();
    await shot(page, name);
  });

test("loading can be closed without late results reopening the panel", async ({
  page,
}) => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  await open(page, {
    readText: async (_route, _count, reply) => {
      await wait;
      await reply({ data: ready }).catch(() => {});
    },
  });
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(
    "Loading extracted text…",
  );
  await shot(page, "loading");
  await panel(page)
    .getByRole("button", { name: "Close extracted text" })
    .click();
  release();
  await expect(panel(page)).toHaveCount(0);
});

test("search result also opens extracted text", async ({ page }) => {
  await open(page, { role: "student" });
  await page
    .getByRole("searchbox", { name: "Search resources" })
    .fill("Lecture");
  const results = page.getByRole("region", { name: "Search results" });
  await results.getByRole("button", { name: "View extracted text" }).click();
  await expect(
    results
      .getByRole("region", { name: "Extracted text for Lecture reading" })
      .locator("pre"),
  ).toHaveText(ready.text);
  await shot(page, "search-result-text");
});

for (const width of [1280, 390])
  test(`compact arrows and readable text at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { orders } = await open(page);
    const first = card(page),
      controls = first.getByRole("group", { name: "Reorder Lecture reading" });
    const up = controls.getByRole("button", {
        name: "Move resource up",
        exact: true,
      }),
      down = controls.getByRole("button", {
        name: "Move resource down",
        exact: true,
      });
    await expect(up).toBeDisabled();
    await expect(down).toBeEnabled();
    const a = await controls.boundingBox(),
      b = await first.boundingBox(),
      target = await down.boundingBox();
    expect(a.x + a.width).toBeGreaterThan(b.x + b.width - 30);
    expect(a.width).toBeLessThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(40);
    expect(target.width).toBeGreaterThanOrEqual(40);
    await first.getByRole("button", { name: "View extracted text" }).click();
    await expect(panel(page).locator("pre")).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
    await shot(page, `arrows-and-text-${width}`);
    await down.click();
    await expect.poll(() => orders.length).toBe(1);
    expect(orders[0]).toEqual({
      ids: ["slides", "notes", "link"],
      sectionId: null,
    });
    await expect(
      page
        .locator(".resource-section .course-files-list li")
        .first()
        .getByRole("link")
        .first(),
    ).toHaveText("Lecture slides");
    await page.getByLabel("Sort resources").selectOption("title");
    await expect(
      page.getByRole("button", { name: "Move resource up" }),
    ).toHaveCount(0);
  });

test("readable paragraphs and UTF-8 text download preserve the original option", async ({
  page,
}) => {
  const original =
    "ARTICLE HEADING\n\nThis article discusses civic culture and the relationship between democracy and\ninterpersonal trust across countries.\n\nand continues the same sentence without a forced paragraph break.\n\nYear Value\n1994 12\n1995 15";
  await open(page, {
    role: "student",
    readText: (_route, _count, reply) =>
      reply({ data: { ...ready, text: original } }),
  });
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  const text = panel(page).locator("pre");
  await expect(text).toContainText(
    "democracy and interpersonal trust across countries.",
  );
  await expect(text).toContainText("Year Value\n1994 12\n1995 15");
  const readable = await text.textContent();
  const textDownload = panel(page).getByRole("link", { name: "Download .txt" });
  await expect(textDownload).toHaveAttribute("target", "_blank");
  await expect(textDownload).toHaveAttribute("rel", "noopener noreferrer");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    panel(page).getByRole("link", { name: "Download .txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Lecture reading.txt");
  expect(await readFile(await download.path(), "utf8")).toBe(readable);
  await shot(page, "readable-paragraphs-download");
  await panel(page).getByLabel("Text layout").selectOption("original");
  await expect(text).toHaveText(original);
  const [originalDownload] = await Promise.all([
    page.waitForEvent("download"),
    panel(page).getByRole("link", { name: "Download .txt" }).click(),
  ]);
  expect(await readFile(await originalDownload.path(), "utf8")).toBe(original);
  await shot(page, "original-line-breaks-download");
});
