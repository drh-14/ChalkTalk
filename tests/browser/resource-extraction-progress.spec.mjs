import { Buffer } from "node:buffer";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";
test.use({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(
  root,
  "test-results/browser-screenshots/resource-extraction-progress",
);
let vite, origin;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  vite = await createServer({
    root: resolve(root, "apps/web"),
    server: { host: "127.0.0.1", port: 5194, strictPort: true },
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
  fileName: `${id}.pdf`,
  mediaType: "application/pdf",
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
async function open(
  page,
  {
    role = "instructor",
    readText,
    readMetadata,
    initialItems,
    catalogPage,
    searchPage,
    handleRequest,
  } = {},
) {
  let items = [
    file("notes", "Lecture reading"),
    file("slides", "Lecture slides"),
    {
      ...file("link", "Course website"),
      kind: "link",
      url: "https://example.edu",
    },
  ];
  if (initialItems) items = initialItems;
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
    if (
      handleRequest &&
      (await handleRequest(route, reply, url, (next) => {
        items = next;
      }))
    )
      return;
    if (path.endsWith("/text")) {
      textRequests.push(path);
      return readText
        ? readText(route, textRequests.length, reply)
        : reply({ data: ready });
    }
    if (path.endsWith("/resources/notes") && readMetadata)
      return readMetadata(route, reply);
    if (path.endsWith("/resources/order")) {
      const body = req.postDataJSON();
      orders.push(body);
      items = body.ids.map((id) => items.find((item) => item.id === id));
      return reply({ data: { version: 2 } });
    }
    if (path.endsWith("/resources/search"))
      return reply(
        searchPage
          ? searchPage(url)
          : {
              data: [
                { resource: items[0], match: { inTitle: true, snippet: null } },
              ],
              page: { hasMore: false, nextCursor: null },
            },
      );
    if (path.endsWith("/resources"))
      return reply(
        catalogPage
          ? catalogPage(url, items)
          : {
              data: items,
              version: orders.length + 1,
              page: { hasMore: false, nextCursor: null },
            },
      );
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

const pending = (
  phase = "queued",
  completedPages = null,
  totalPages = null,
) => ({
  ...file("notes", "Lecture reading"),
  textStatus: "pending",
  textProgress: { phase, completedPages, totalPages },
});
for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} progress completes automatically with drafts and download intact`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    let metadata = pending(),
      checks = 0,
      fullText = 0;
    const { textRequests } = await open(page, {
      initialItems: [metadata],
      readMetadata: (_route, reply) => {
        checks++;
        return reply({ data: metadata });
      },
      readText: (_route, _count, reply) => {
        fullText++;
        return reply({
          data:
            metadata.textStatus === "ready"
              ? ready
              : { ...ready, status: "pending", text: null },
        });
      },
    });
    await expect(card(page).getByText("Queued for extraction")).toBeVisible();
    await shot(page, `${mobile ? "mobile" : "desktop"}-queued`);
    await page
      .getByRole("textbox", { name: "File title", exact: true })
      .fill("Unsaved upload title");
    await page.getByLabel("Choose a course file").setInputFiles({
      name: "selected-not-uploaded.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Unsaved file"),
    });
    await card(page)
      .getByRole("button", { name: "Edit Lecture reading" })
      .click();
    await card(page)
      .getByRole("textbox", { name: "Resource title" })
      .fill("Unsaved resource title");
    await card(page)
      .getByRole("button", { name: "View extracted text" })
      .click();
    await expect(panel(page).getByText("Queued for extraction")).toBeVisible();
    for (const [phase, label, completed, total] of [
      ["preparing", "Preparing extraction", null, null],
      ["ocr", "OCR: 7 of 18 pages", 7, 18],
      ["saving", "Saving extracted text", null, null],
    ]) {
      metadata = pending(phase, completed, total);
      await page.clock.runFor(2000);
      await expect(panel(page).getByText(label)).toBeVisible();
      if (phase === "ocr")
        await expect(
          panel(page).getByRole("progressbar", { name: "OCR pages" }),
        ).toHaveAttribute("value", "7");
      await shot(page, `${mobile ? "mobile" : "desktop"}-${phase}`);
    }
    expect(fullText).toBe(1);
    expect(checks).toBe(3);
    metadata = { ...metadata, textStatus: "ready", textProgress: null };
    await page.clock.runFor(2000);
    await expect(panel(page).locator("pre")).toContainText(
      "Extracted reading text.",
    );
    expect(textRequests).toHaveLength(2);
    await expect(
      card(page).getByRole("textbox", { name: "Resource title" }),
    ).toHaveValue("Unsaved resource title");
    await expect(
      page.getByRole("textbox", { name: "File title", exact: true }),
    ).toHaveValue("Unsaved upload title");
    expect(
      await page
        .getByLabel("Choose a course file")
        .evaluate((input) => input.files[0].name),
    ).toBe("selected-not-uploaded.txt");
    const download = page.waitForEvent("download");
    await panel(page).getByRole("link", { name: "Download .txt" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.txt$/);
    await shot(page, `${mobile ? "mobile" : "desktop"}-automatic-ready`);
    await page.clock.runFor(20_000);
    expect(checks).toBe(4);
  });
}
test("another edit to the same file keeps checks running until text is ready", async ({
  page,
}) => {
  await page.clock.install();
  let metadata = {
    ...pending("ocr", 7, 18),
    title: "Renamed elsewhere",
    version: 2,
  };
  await open(page, {
    initialItems: [pending("ocr", 7, 18)],
    readMetadata: (_route, reply) => reply({ data: metadata }),
    readText: (_route, _count, reply) =>
      reply({
        data:
          metadata.textStatus === "ready"
            ? ready
            : { ...ready, status: "pending", text: null },
      }),
  });
  await card(page)
    .getByRole("button", { name: "Edit Lecture reading" })
    .click();
  await card(page)
    .getByRole("textbox", { name: "Resource title" })
    .fill("Unsaved resource title");
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  metadata = {
    ...metadata,
    textProgress: { phase: "saving", completedPages: null, totalPages: null },
  };
  await page.clock.runFor(2000);
  await expect(panel(page).getByText("Saving extracted text")).toBeVisible();
  await expect(page.getByText("Automatic checks paused")).toHaveCount(0);
  metadata = { ...metadata, textStatus: "ready", textProgress: null };
  await page.clock.runFor(2000);
  await expect(panel(page).locator("pre")).toContainText(
    "Extracted reading text.",
  );
  await expect(
    panel(page).getByRole("link", { name: "Download .txt" }),
  ).toBeVisible();
  await expect(page.getByText("Renamed elsewhere")).toHaveCount(0);
  await expect(
    card(page).getByRole("textbox", { name: "Resource title" }),
  ).toHaveValue("Unsaved resource title");
  await shot(page, "desktop-same-file-edit-completes");
});
test("student watches only an open panel and closing cancels checks", async ({
  page,
}) => {
  await page.clock.install();
  let checks = 0;
  await open(page, {
    role: "student",
    initialItems: [pending("ocr", 7, 18)],
    readMetadata: (_r, reply) => {
      checks++;
      return reply({ data: pending("ocr", 7, 18) });
    },
    readText: (_r, _n, reply) =>
      reply({ data: { ...ready, status: "pending", text: null } }),
  });
  await expect(card(page).getByRole("progressbar")).toHaveCount(0);
  await page.clock.runFor(4000);
  expect(checks).toBe(0);
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).getByRole("progressbar")).toBeVisible();
  await page.clock.runFor(2500);
  await expect.poll(() => checks).toBe(1);
  await shot(page, "student-open-panel-ocr");
  await panel(page)
    .getByRole("button", { name: "Close extracted text" })
    .click();
  await page.clock.runFor(10_000);
  expect(checks).toBe(1);
  await shot(page, "student-closed-no-card-progress");
});
test("bounded checks offer recovery and authorization loss clears the resource", async ({
  page,
}) => {
  await page.clock.install();
  let checks = 0,
    unavailable = false;
  await open(page, {
    initialItems: [pending("preparing")],
    readMetadata: (_r, reply) => {
      checks++;
      return unavailable
        ? reply({ error: { code: "not_found", message: "missing" } }, 404)
        : reply({ data: pending("preparing") });
    },
  });
  await page.clock.runFor(16 * 60_000);
  await expect(
    card(page).getByRole("button", { name: "Check again" }),
  ).toBeVisible();
  await shot(page, "desktop-check-again");
  const before = checks;
  await page.clock.runFor(60_000);
  expect(checks).toBe(before);
  unavailable = true;
  await card(page).getByRole("button", { name: "Check again" }).click();
  await page.clock.runFor(1);
  await expect(
    page.getByRole("link", { name: "Lecture reading", exact: true }),
  ).toHaveCount(0);
  await shot(page, "desktop-authorization-loss");
});

test("progress preserves loaded catalog and search pages, snippets, sort and selected file", async ({
  page,
}) => {
  await page.clock.install();
  let metadata = pending("preparing"),
    catalogReads = 0,
    searchReads = 0,
    checks = 0;
  const extra = file("second", "Second loaded reading");
  const snippet = {
    text: "retained matching passage",
    highlights: [{ start: 9, length: 8 }],
  };
  await open(page, {
    initialItems: [metadata],
    catalogPage: (url) => {
      catalogReads++;
      return {
        data: url.searchParams.has("cursor") ? [extra] : [metadata],
        version: 1,
        page: {
          hasMore: true,
          nextCursor: url.searchParams.has("cursor")
            ? "catalog-third"
            : "catalog-second",
        },
      };
    },
    searchPage: (url) => {
      searchReads++;
      return {
        data: [
          {
            resource: url.searchParams.has("cursor") ? extra : metadata,
            match: { inTitle: true, snippet },
          },
        ],
        page: {
          hasMore: true,
          nextCursor: url.searchParams.has("cursor")
            ? "search-third"
            : "search-second",
        },
      };
    },
    readMetadata: (_r, reply) => {
      checks++;
      return reply({ data: metadata });
    },
  });
  const initialCatalogReads = catalogReads;
  await page
    .getByRole("combobox", { name: "Sort resources" })
    .selectOption("title");
  await expect.poll(() => catalogReads).toBe(initialCatalogReads + 1);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(
    page.getByRole("link", { name: extra.title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Choose a course file").setInputFiles({
    name: "draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("unsaved"),
  });
  await page
    .getByRole("textbox", { name: "File title", exact: true })
    .fill("Draft retained across checks");
  const readsBefore = catalogReads;
  metadata = pending("ocr", 7, 18);
  await page.clock.runFor(2500);
  await expect(card(page).getByText("OCR: 7 of 18 pages")).toBeVisible();
  expect(catalogReads).toBe(readsBefore);
  await expect(
    page.getByRole("combobox", { name: "Sort resources" }),
  ).toHaveValue("title");
  await shot(page, "desktop-loaded-catalog-selected-file");
  await page
    .getByRole("searchbox", { name: "Search resources" })
    .fill("reading");
  await page.clock.runFor(400);
  const results = page.getByRole("region", { name: "Search results" });
  await expect(results.locator("mark")).toHaveText("matching");
  await results.getByRole("button", { name: "Load more results" }).click();
  await expect(results.getByRole("link", { name: extra.title })).toBeVisible();
  const searchesBefore = searchReads;
  metadata = { ...metadata, textStatus: "ready", textProgress: null };
  await page.clock.runFor(2500);
  await expect(results.getByText("OCR: 7 of 18 pages")).toHaveCount(0);
  expect(searchReads).toBe(searchesBefore);
  expect(catalogReads).toBe(readsBefore);
  await expect(results.locator("mark")).toHaveText(["matching", "matching"]);
  await expect(
    results.getByRole("button", { name: "Load more results" }),
  ).toBeVisible();
  await expect(page.getByLabel("File title", { exact: true })).toHaveValue(
    "Draft retained across checks",
  );
  expect(
    await page
      .getByLabel("Choose a course file")
      .evaluate((input) => input.files[0].name),
  ).toBe("draft.txt");
  expect(checks).toBeGreaterThan(0);
  await shot(page, "desktop-loaded-search-snippets-retained");
  await page.getByRole("button", { name: "Clear resource search" }).click();
  await expect(
    page.getByRole("link", { name: extra.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toBeVisible();
  expect(catalogReads).toBe(readsBefore);
  await shot(page, "desktop-catalog-retained-after-search");
});
test("hidden-tab checks pause and transient errors recover with retained progress", async ({
  page,
}) => {
  await page.clock.install();
  let checks = 0,
    offline = true;
  await open(page, {
    initialItems: [pending("ocr", 7, 18)],
    readMetadata: (_r, reply) => {
      checks++;
      return offline
        ? reply({ error: { message: "offline" } }, 503)
        : reply({ data: pending("saving") });
    },
  });
  await page.evaluate(() => {
    globalThis.testTabHidden = true;
    Object.defineProperty(globalThis.document, "hidden", {
      configurable: true,
      get: () => globalThis.testTabHidden,
    });
    globalThis.document.dispatchEvent(new globalThis.Event("visibilitychange"));
  });
  await page.clock.runFor(40_000);
  expect(checks).toBe(0);
  await shot(page, "desktop-hidden-retains-progress");
  await page.evaluate(() => {
    globalThis.testTabHidden = false;
    globalThis.document.dispatchEvent(new globalThis.Event("visibilitychange"));
  });
  await page.clock.runFor(1);
  await expect(
    card(page).getByText(
      "Extraction updates are unavailable. Please try again.",
    ),
  ).toBeVisible();
  await expect(card(page).getByText("OCR: 7 of 18 pages")).toBeVisible();
  await shot(page, "desktop-transient-error-retains-progress");
  offline = false;
  await page.clock.runFor(10_000);
  await expect(card(page).getByText("Saving extracted text")).toBeVisible();
  await expect(
    card(page).getByText(
      "Extraction updates are unavailable. Please try again.",
    ),
  ).toHaveCount(0);
  await shot(page, "desktop-transient-error-recovered");
});
test("a delayed old poll cannot restore a replaced file or reopen its panel", async ({
  page,
}) => {
  await page.clock.install();
  let release,
    waiting = false;
  const replacement = {
    ...file("notes", "Replacement reading"),
    fileId: "replacement-file",
    fileName: "replacement.txt",
    mediaType: "text/plain",
    version: 2,
  };
  await open(page, {
    initialItems: [pending("ocr", 7, 18)],
    readText: (_r, _n, reply) =>
      reply({ data: { ...ready, status: "pending", text: null } }),
    readMetadata: async (_route, reply) => {
      waiting = true;
      await new Promise((done) => {
        release = done;
      });
      await reply({ data: pending("ocr", 18, 18) });
    },
    handleRequest: async (route, reply, url, setItems) => {
      if (
        url.pathname.endsWith("/resources/notes/file") &&
        route.request().method() === "PUT"
      ) {
        setItems([replacement]);
        await reply({ data: replacement });
        return true;
      }
      return false;
    },
  });
  await card(page).getByRole("button", { name: "View extracted text" }).click();
  await expect(panel(page).getByText("OCR: 7 of 18 pages")).toBeVisible();
  await page.clock.runFor(2500);
  await expect.poll(() => waiting).toBe(true);
  await card(page)
    .getByRole("button", { name: "Edit Lecture reading" })
    .click();
  await card(page)
    .getByLabel("Replacement file")
    .setInputFiles({
      name: "replacement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("replacement"),
    });
  await card(page).getByRole("button", { name: "Save resource" }).click();
  await expect(
    page.getByRole("link", { name: replacement.title, exact: true }),
  ).toBeVisible();
  release();
  await page.clock.runFor(100);
  await expect(page.getByText("OCR: 18 of 18 pages")).toHaveCount(0);
  await expect(
    page.getByRole("region", {
      name: "Extracted text for Lecture reading",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: replacement.title, exact: true }),
  ).toHaveAttribute(
    "href",
    "/api/v1/courses/course-1/files/replacement-file/download",
  );
  await shot(page, "desktop-replacement-discards-old-poll");
});
