import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = resolve(root, "docs/pr-screenshots/course-files");
const file = {
  kind: "upload",
  id: "file-1",
  courseId: "course-1",
  fileName: "Lecture notes.txt",
  mediaType: "text/plain",
  sizeBytes: 1024,
  createdAt: "2026-10-18T12:00:00Z",
};
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
async function open(
  page,
  {
    role = "student",
    status = "active",
    files = [file],
    failList = false,
    more = false,
    failUpload = false,
    listGate,
    uploadGate,
    failNextPage = false,
    failLink = false,
    linkGate,
    nextFiles,
  } = {},
) {
  const uploads = [];
  uploads.links = [];
  let failRead = failList;
  uploads.recoverList = () => {
    failRead = false;
    failNextPage = false;
  };
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const respond = (body, code = 200, headers = {}) =>
      route.fulfill({
        status: code,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });
    if (url.pathname === "/api/v1/sessions/current")
      return respond({
        data: {
          id: "session",
          user: {
            id: "user-1",
            displayName: "Alex Student",
            email: "alex@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (url.pathname === "/api/v1/courses/course-1/members/user-1")
      return respond({ data: { role } });
    if (url.pathname === "/api/v1/courses/course-1")
      return respond(
        { data: { id: "course-1", name: "Physics", status } },
        200,
        { ETag: '"v1"' },
      );
    if (
      url.pathname === "/api/v1/courses/course-1/resources" &&
      req.method() === "GET"
    ) {
      if (listGate) await listGate;
      if (failRead || (failNextPage && url.searchParams.has("cursor")))
        return respond(
          { error: { message: "Files temporarily unavailable" } },
          503,
        );
      if (url.searchParams.has("cursor"))
        return respond({
          data: nextFiles ?? [
            { ...file, id: "file-2", fileName: "Second page.md" },
          ],
          page: { hasMore: false, nextCursor: null },
        });
      return respond({
        data: files,
        page: { hasMore: more, nextCursor: more ? "next-page" : null },
      });
    }
    if (
      url.pathname === "/api/v1/courses/course-1/files" &&
      req.method() === "POST"
    ) {
      uploads.push({
        key: req.headers()["idempotency-key"],
        csrf: req.headers()["x-csrf-token"],
        body: req.postData(),
      });
      if (uploadGate) await uploadGate;
      if (failUpload && uploads.length === 1)
        return respond(
          { error: { message: "Storage unavailable. Try again." } },
          503,
        );
      files = [
        { ...file, id: "new-file", fileName: "New notes.txt" },
        ...files,
      ];
      return respond({ data: files[0] }, 201);
    }
    if (
      url.pathname === "/api/v1/courses/course-1/resources" &&
      req.method() === "POST"
    ) {
      uploads.links.push({
        key: req.headers()["idempotency-key"],
        csrf: req.headers()["x-csrf-token"],
        body: req.postDataJSON(),
      });
      if (linkGate) await linkGate;
      if (failLink && uploads.links.length === 1)
        return respond(
          { error: { message: "Link creation unavailable" } },
          503,
        );
      const link = {
        kind: "link",
        id: "link-new",
        courseId: "course-1",
        title: req.postDataJSON().title,
        url: req.postDataJSON().url,
        createdAt: file.createdAt,
      };
      files = [link, ...files];
      return respond({ data: link }, 201);
    }
    if (url.pathname.endsWith("/download"))
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Disposition": 'attachment; filename="Lecture notes.txt"',
        },
        contentType: "text/plain",
        body: "original bytes",
      });
    if (url.pathname === "/api/v1/courses")
      return respond({ data: [], page: { hasMore: false, nextCursor: null } });
    throw new Error(`Unexpected API ${req.method()} ${url.pathname}`);
  });
  await page.goto(`${origin}/courses/course-1/resources`);
  await expect(
    page.getByRole("heading", { name: "Course resources", exact: true }),
  ).toBeVisible();
  return uploads;
}
async function shot(page, name) {
  await page.screenshot({
    path: resolve(evidence, `${name}.png`),
    fullPage: true,
  });
}

test("members see actual files and download original bytes", async ({
  page,
}) => {
  await open(page);
  const link = page.getByRole("link", { name: /Lecture notes.txt/ });
  await expect(link).toHaveAttribute(
    "href",
    "/api/v1/courses/course-1/files/file-1/download",
  );
  await expect(page.getByText("1 KB", { exact: true })).toBeVisible();
  await shot(page, "populated");
  const downloadEvent = page.waitForEvent("download");
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("Lecture notes.txt");
  const chunks = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe("original bytes");
  await shot(page, "download");
});

test("empty state and list error can be retried", async ({ page }) => {
  const controls = await open(page, { files: [], failList: true });
  await expect(page.getByRole("alert")).toContainText(
    "Files temporarily unavailable",
  );
  await shot(page, "load-error");
  controls.recoverList();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No course resources yet.")).toBeVisible();
  await shot(page, "empty");
});

test("members load another page without losing the first", async ({ page }) => {
  await open(page, { more: true });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByRole("link", { name: /Second page.md/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Lecture notes.txt/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await shot(page, "pagination");
});

for (const [role, status] of [
  ["student", "active"],
  ["ta", "active"],
  ["instructor", "archived"],
]) {
  test(`${role} in ${status} course is readonly`, async ({ page }) => {
    await open(page, {
      role,
      status,
      files: [
        file,
        {
          kind: "link",
          id: "readonly-link",
          courseId: "course-1",
          title: "Course handbook",
          url: "https://example.edu/handbook",
          createdAt: file.createdAt,
        },
      ],
    });
    await expect(
      page.getByRole("link", { name: /Lecture notes.txt/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Choose a course file")).toHaveCount(0);
    await expect(page.getByLabel("Link title", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(
      0,
    );
    await shot(page, `${role}-${status}-readonly`);
  });
}

test("instructor retries upload with the same key and preserves existing files on error", async ({
  page,
}) => {
  const uploads = await open(page, { role: "instructor", failUpload: true });
  await page.getByLabel("Choose a course file").setInputFiles({
    name: "New notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Course notes"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("alert")).toContainText("Storage unavailable");
  await expect(
    page.getByRole("link", { name: /Lecture notes.txt/ }),
  ).toBeVisible();
  await shot(page, "upload-failure");
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "New notes.txt uploaded." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /New notes.txt/ })).toBeVisible();
  expect(uploads).toHaveLength(2);
  expect(uploads[0].key).toBeTruthy();
  expect(uploads[0].key).toBe(uploads[1].key);
  expect(uploads[0].csrf).toBe("csrf");
  expect(uploads[0].body).toContain('name="file"');
  await shot(page, "upload-success");
  await page.getByLabel("Choose a course file").setInputFiles({
    name: "Other.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Other"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect.poll(() => uploads.length).toBe(3);
  expect(uploads[2].key).not.toBe(uploads[1].key);
  await expect(
    page.getByRole("status").filter({ hasText: "Other.txt uploaded." }),
  ).toBeVisible();
});

test("mobile wraps long literal filenames and keyboard reaches the download", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const name =
    '<script>alert("not executed")</script>' + "long-name-".repeat(12) + ".txt";
  await open(page, { files: [{ ...file, fileName: name }] });
  await expect(
    page.getByRole("link", { name: new RegExp("not executed") }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: /not executed/ }).focus();
  await expect(page.getByRole("link", { name: /not executed/ })).toBeFocused();
  await shot(page, "mobile");
});

test("loading feedback and retrying failed pagination retain existing files", async ({
  page,
}) => {
  let release;
  const listGate = new Promise((resolve) => {
    release = resolve;
  });
  const controls = await open(page, {
    more: true,
    listGate,
    failNextPage: true,
  });
  await expect(page.getByRole("status")).toHaveText("Loading course files…");
  await shot(page, "loading");
  release();
  await expect(
    page.getByRole("link", { name: /Lecture notes.txt/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Files temporarily unavailable",
  );
  await expect(
    page.getByRole("link", { name: /Lecture notes.txt/ }),
  ).toBeVisible();
  await shot(page, "pagination-error");
  controls.recoverList();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("link", { name: /Second page.md/ }),
  ).toBeVisible();
  await shot(page, "pagination-retry");
});

test("upload progress prevents duplicate submission", async ({ page }) => {
  let release;
  const uploadGate = new Promise((resolve) => {
    release = resolve;
  });
  const uploads = await open(page, { role: "instructor", uploadGate });
  await page.getByLabel("Choose a course file").setInputFiles({
    name: "New notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("notes"),
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByRole("button", { name: "Uploading…" })).toBeDisabled();
  await expect(page.getByLabel("Choose a course file")).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Uploading your file…");
  await shot(page, "upload-progress");
  expect(uploads).toHaveLength(1);
  release();
  await expect(
    page.getByText("New notes.txt uploaded.", { exact: true }),
  ).toBeVisible();
});

test("flat mixed resources have filename-only downloads and safely named external links", async ({
  page,
}) => {
  await open(page, {
    files: [
      file,
      {
        kind: "link",
        id: file.id,
        courseId: "course-1",
        title: "Course handbook",
        url: "https://example.edu/handbook",
        createdAt: file.createdAt,
      },
    ],
  });
  await expect(
    page.getByRole("link", { name: "Lecture notes.txt", exact: true }),
  ).toHaveAttribute("href", "/api/v1/courses/course-1/files/file-1/download");
  await expect(page.getByText("Download", { exact: true })).toHaveCount(0);
  const external = page.getByRole("link", { name: /Course handbook/ });
  await expect(external).toHaveAttribute(
    "href",
    "https://example.edu/handbook",
  );
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await shot(page, "mixed-resources");
  await page.context().route("https://example.edu/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<title>Course handbook</title>",
    }),
  );
  const popupEvent = page.waitForEvent("popup");
  await external.click();
  const popup = await popupEvent;
  await popup.waitForLoadState();
  expect(popup.url()).toBe("https://example.edu/handbook");
  expect(await popup.evaluate(() => globalThis.opener)).toBe(null);
  await popup.close();
});
test("instructor retries link submission and changed input gets a new key", async ({
  page,
}) => {
  const controls = await open(page, { role: "instructor", failLink: true });
  await page.getByLabel("Link title", { exact: true }).fill("Course handbook");
  await page
    .getByLabel("Link URL", { exact: true })
    .fill("https://example.edu/handbook");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Link creation unavailable",
  );
  await expect(
    page.getByRole("link", { name: "Lecture notes.txt", exact: true }),
  ).toBeVisible();
  await shot(page, "link-error");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(
    page.getByRole("link", { name: /Course handbook/ }),
  ).toBeVisible();
  expect(controls.links[0].key).toBeTruthy();
  expect(controls.links[1].key).toBe(controls.links[0].key);
  expect(controls.links[0].csrf).toBe("csrf");
  await shot(page, "link-success");
  await page.getByLabel("Link title", { exact: true }).fill("Other site");
  await page
    .getByLabel("Link URL", { exact: true })
    .fill("http://example.edu/other");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect.poll(() => controls.links.length).toBe(3);
  expect(controls.links[2].key).not.toBe(controls.links[1].key);
});

test("instructor can submit code-point limit titles and URLs", async ({
  page,
}) => {
  const controls = await open(page, { role: "instructor" });
  const title = "😀".repeat(200);
  const prefix = "https://example.edu/";
  const url = prefix + "😀".repeat(2048 - [...prefix].length);
  await page.getByLabel("Link title", { exact: true }).fill(title);
  await page.getByLabel("Link URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect.poll(() => controls.links.length).toBe(1);
  expect(controls.links[0].body).toEqual({ kind: "link", title, url });
  await expect(
    page.getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();
  await shot(page, "link-unicode-boundary");
});

test("oversized code-point inputs show errors without losing existing resources", async ({
  page,
}) => {
  const controls = await open(page, { role: "instructor" });
  const titleInput = page.getByLabel("Link title", { exact: true });
  const urlInput = page.getByLabel("Link URL", { exact: true });
  await titleInput.fill("😀".repeat(201));
  await urlInput.fill("https://example.edu/notes");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "200 characters or fewer",
  );
  await expect(
    page.getByRole("link", { name: "Lecture notes.txt" }),
  ).toBeVisible();
  expect(controls.links).toHaveLength(0);
  await shot(page, "link-title-too-long");
  await titleInput.fill("Notes");
  const prefix = "https://example.edu/";
  await urlInput.fill(prefix + "😀".repeat(2049 - [...prefix].length));
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "2048 characters or fewer",
  );
  expect(controls.links).toHaveLength(0);
  await shot(page, "link-url-too-long");
});

test("mixed pagination preserves equal-ID file and link entries", async ({
  page,
}) => {
  await open(page, {
    more: true,
    files: [file],
    nextFiles: [
      {
        kind: "link",
        id: file.id,
        courseId: "course-1",
        title: "Same ID link",
        url: "https://example.edu/same",
        createdAt: file.createdAt,
      },
    ],
  });
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(
    page.getByRole("link", { name: "Lecture notes.txt", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Same ID link/ })).toBeVisible();
  await shot(page, "mixed-pagination");
});
test("link progress disables duplicate submission", async ({ page }) => {
  let release;
  const linkGate = new Promise((resolve) => {
    release = resolve;
  });
  const controls = await open(page, { role: "instructor", linkGate });
  await page.getByLabel("Link title", { exact: true }).fill("Progress link");
  await page
    .getByLabel("Link URL", { exact: true })
    .fill("https://example.edu/progress");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Adding link…" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Link title", { exact: true })).toBeDisabled();
  expect(controls.links).toHaveLength(1);
  await shot(page, "link-progress");
  release();
  await expect(page.getByRole("link", { name: /Progress link/ })).toBeVisible();
});
test("mobile mixed resources and link controls remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, {
    role: "instructor",
    files: [
      file,
      {
        kind: "link",
        id: "mobile-link",
        courseId: "course-1",
        title: "A long external resource title ".repeat(5),
        url: "https://example.edu/mobile",
        createdAt: file.createdAt,
      },
    ],
  });
  await expect(page.getByLabel("Link title", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await shot(page, "mixed-mobile");
});

for (const [device, width] of [
  ["desktop", 1280],
  ["mobile", 390],
]) {
  test(`Resources action buttons retain colors with refined spacing on ${device}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests = await open(page, {
      role: "instructor",
      failList: true,
      more: true,
    });
    const assertButton = async (name, primary) => {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const styles = await button.evaluate((element) => {
        const style = globalThis.getComputedStyle(element);
        return {
          radius: style.borderRadius,
          padding: style.padding,
          background: style.backgroundColor,
          color: style.color,
        };
      });
      expect(styles).toEqual({
        radius: "13.6px",
        padding: "12px 20px",
        background: primary ? "rgb(31, 77, 62)" : "rgb(233, 238, 229)",
        color: primary ? "rgb(255, 253, 247)" : "rgb(36, 81, 63)",
      });
    };
    await assertButton("Upload file", true);
    await assertButton("Add link", true);
    await assertButton("Try again", false);
    await shot(page, `buttons-${device}-retry`);
    requests.recoverList();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await assertButton("Load more", false);
    await expect(
      page.getByRole("link", { name: "Lecture notes.txt", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
    await shot(page, `buttons-${device}`);
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Second page.md", exact: true }),
    ).toBeVisible();
  });
}

for (const [device, width] of [
  ["desktop", 1280],
  ["mobile", 390],
]) {
  test(`native resource Choose File matches Add link and keeps picker access on ${device}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let release;
    const uploadGate = new Promise((resolve) => {
      release = resolve;
    });
    await open(page, { role: "instructor", uploadGate });
    const picker = page.getByLabel("Choose a course file", { exact: true });
    const primary = page.getByRole("button", { name: "Add link", exact: true });
    await page.getByLabel("Link title", { exact: true }).fill("Handbook");
    await page
      .getByLabel("Link URL", { exact: true })
      .fill("https://example.edu/handbook");
    await expect(primary).toBeEnabled();
    await expect(picker).toHaveAttribute(
      "accept",
      ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.docx,.pptx",
    );
    const read = async (locator, properties, pseudo = false) =>
      locator.evaluate(
        (element, { properties, pseudo }) => {
          const style = globalThis.getComputedStyle(
            element,
            pseudo ? "::file-selector-button" : null,
          );
          return Object.fromEntries(
            properties.map((property) => [
              property,
              style.getPropertyValue(property),
            ]),
          );
        },
        { properties, pseudo },
      );
    const appearance = [
      "background-color",
      "color",
      "border-top-width",
      "border-top-style",
      "font-family",
      "font-size",
      "font-weight",
      "border-radius",
      "padding",
      "min-height",
      "cursor",
    ];
    await page.mouse.move(0, 0);
    expect(await read(picker, appearance, true)).toEqual(
      await read(primary, appearance),
    );
    await shot(page, `browse-${device}`);
    await primary.hover();
    await expect
      .poll(
        async () =>
          (await read(primary, ["background-color"]))["background-color"],
      )
      .toBe("rgb(23, 61, 49)");
    const hover = await read(primary, ["background-color", "transform"]);
    await picker.hover({ position: { x: 20, y: 20 } });
    await expect
      .poll(() => read(picker, ["background-color", "transform"], true))
      .toEqual(hover);
    await shot(page, `browse-${device}-hover`);
    await primary.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const outline = await read(primary, [
      "outline-color",
      "outline-style",
      "outline-width",
      "outline-offset",
    ]);
    await picker.focus();
    await expect
      .poll(() =>
        picker.evaluate((element) => element.matches(":focus-visible")),
      )
      .toBe(true);
    expect(
      await read(picker, [
        "outline-color",
        "outline-style",
        "outline-width",
        "outline-offset",
      ]),
    ).toEqual(outline);
    await shot(page, `browse-${device}-focus`);
    const clicked = page.waitForEvent("filechooser");
    await picker.click({ position: { x: 20, y: 20 } });
    await (
      await clicked
    ).setFiles({
      name: "Clicked notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("clicked"),
    });
    await expect(
      page.getByRole("button", { name: "Upload file", exact: true }),
    ).toBeEnabled();
    const keyed = page.waitForEvent("filechooser");
    await picker.focus();
    await picker.press("Enter");
    await (
      await keyed
    ).setFiles({
      name: "Keyboard notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("keyboard"),
    });
    await expect(picker).toHaveValue(/Keyboard notes\.txt$/);
    expect(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
    ).toBe(true);
    await shot(page, `browse-${device}-selected`);
    await page
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await expect(picker).toBeDisabled();
    await expect(primary).toBeDisabled();
    expect(await read(picker, ["opacity", "cursor"], true)).toEqual(
      await read(primary, ["opacity", "cursor"]),
    );
    await shot(page, `browse-${device}-disabled`);
    release();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Keyboard notes.txt uploaded." }),
    ).toBeVisible();
  });
}
