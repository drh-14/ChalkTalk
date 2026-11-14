import { mkdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const evidence =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/slide-anchored-questions");
let vite, origin, pdf;
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
  pdf = await readFile(
    resolve(import.meta.dirname, "fixtures/lecture-slides.pdf"),
  );
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

const course = "course-1";
const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
const resource = {
  id: "slides",
  courseId: course,
  kind: "upload",
  title: "Lecture 7 — Balanced Search Trees",
  sectionId: null,
  visibility: "class",
  position: 0,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  fileId: "file-1",
  fileName: "lecture-07.pdf",
  mediaType: "application/pdf",
  sizeBytes: 86870,
};
const author = {
  userId: "u2",
  displayName: "Ada Lovelace",
  anonymous: false,
  deleted: false,
};
const post = (id, title, anchor, extra = {}) => ({
  id,
  courseId: course,
  type: "question",
  deleted: false,
  title,
  bodyMarkdown: "Where does **B** move during this rotation?",
  author,
  anonymous: false,
  tags: ["hw7"],
  folder: null,
  attachments: [],
  answered: false,
  unresolvedFollowups: 0,
  pinned: false,
  private: false,
  unread: false,
  following: false,
  createdAt: "2026-11-05T14:00:00Z",
  lastActivityAt: "2026-11-05T14:00:00Z",
  version: 1,
  anchor,
  ...extra,
});
const anchorOn = (page, value = box) => ({
  page,
  box: value,
  status: "current",
  resourceId: "slides",
  fileId: "file-1",
  resourceTitle: resource.title,
});

/** Mocks the API for a student in course-1; the posts list is shared state. */
async function mockApi(page, { questions = [], earlier = 0, posts = [] } = {}) {
  const state = { questions: [...questions], posts: [...posts], version: 0 };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, json: body, headers });
    if (path === "/api/v1/sessions/current")
      return json({
        data: {
          id: "session",
          user: {
            id: "u1",
            displayName: "Maya Chen",
            email: "maya@example.edu",
          },
          csrfToken: "csrf",
          expiresAt: "2090-01-01T00:00:00Z",
        },
      });
    if (path === `/api/v1/courses/${course}`)
      return json(
        {
          data: {
            id: course,
            name: "CSE 214 Data Structures",
            status: "active",
            allowAnonymousPosting: true,
            allowPrivatePosting: true,
          },
        },
        200,
        { ETag: '"v1"' },
      );
    if (path.endsWith("/members/u1"))
      return json({ data: { role: "student" } });
    if (path.endsWith("/unread-count")) return json({ data: { count: 0 } });
    if (path === `/api/v1/courses/${course}/resources/slides`)
      return json({ data: resource });
    if (path === `/api/v1/courses/${course}/resources/slides/questions`)
      return json({
        resourceId: "slides",
        fileId: "file-1",
        data: state.questions,
        earlierVersionCount: earlier,
      });
    if (path === `/api/v1/courses/${course}/files/file-1/download`)
      return route.fulfill({
        status: 200,
        body: pdf,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(pdf.length),
        },
      });
    if (path.endsWith("/post-draft")) {
      if (method === "PUT") state.version++;
      if (method === "DELETE") return route.fulfill({ status: 204 });
      return json(
        {
          data: {
            courseId: course,
            content: method === "PUT" ? request.postDataJSON().content : null,
            updatedAt: "2026-11-06T00:00:00Z",
            version: state.version,
          },
        },
        200,
        { ETag: `"v${state.version}"` },
      );
    }
    if (path === `/api/v1/courses/${course}/posts` && method === "POST") {
      const input = request.postDataJSON();
      const created = post("new-1", input.title, {
        ...anchorOn(input.anchor.page, input.anchor.box),
      });
      state.posts.unshift(created);
      state.questions.push({
        id: created.id,
        type: "question",
        title: created.title,
        page: input.anchor.page,
        box: input.anchor.box,
        answered: false,
        unresolvedFollowups: 0,
        unread: false,
        createdAt: created.createdAt,
      });
      return json({ data: created }, 201, { ETag: '"1"' });
    }
    if (path === `/api/v1/courses/${course}/posts`)
      return json({
        data: state.posts,
        page: { hasMore: false, nextCursor: null },
      });
    const single = path.match(/^\/api\/v1\/posts\/([^/]+)$/);
    if (single) {
      const found = state.posts.find((item) => item.id === single[1]);
      return found
        ? json({ data: found }, 200, { ETag: '"1"' })
        : json(
            { error: { code: "not_found", message: "Post is not found" } },
            404,
          );
    }
    if (path.endsWith("/answers") || path.endsWith("/followups"))
      return json({
        data: [],
        meta: { total: 0, nextCursor: null },
        page: { hasMore: false, nextCursor: null },
      });
    return json({ data: [], page: { hasMore: false, nextCursor: null } });
  });
  return state;
}
const shot = (page, name) =>
  page.screenshot({ path: resolve(evidence, `${name}.png`) });
const viewer = (query = "") =>
  `${origin}/courses/${course}/resources/slides/view${query}`;
const renderedPages = (page) =>
  expect
    .poll(() =>
      page
        .locator(".slide-canvas")
        .evaluateAll(
          (canvases) => canvases.filter((canvas) => canvas.width > 0).length,
        ),
    )
    .toBeGreaterThan(0);

for (const [size, viewport] of [
  ["desktop", { width: 1536, height: 864 }],
  ["phone", { width: 390, height: 844 }],
]) {
  test.describe(size, () => {
    test.use({ viewport, hasTouch: size === "phone" });

    test("draws a box on a slide and posts an anchored question", async ({
      page,
    }) => {
      const state = await mockApi(page);
      // The page parameter opens the rotation slide directly.
      await page.goto(viewer("?page=3"));
      await expect(
        page.getByRole("heading", { name: resource.title }),
      ).toBeVisible({
        timeout: 30000,
      });
      await renderedPages(page);
      await expect(page.getByLabel("Page", { exact: true })).toHaveValue("3");
      await shot(page, `${size}-viewer`);
      const slide = page.getByRole("group", { name: "Page 3" });
      await slide.scrollIntoViewIfNeeded();
      if (size === "phone")
        await page.getByRole("button", { name: "Mark an area" }).click();
      const area = await slide.locator(".slide-overlay").boundingBox();
      const from = [area.x + area.width * 0.55, area.y + area.height * 0.4];
      const to = [area.x + area.width * 0.9, area.y + area.height * 0.85];
      if (size === "phone") {
        // A touch drag, dispatched as pointer events with a touch pointer.
        const overlay = slide.locator(".slide-overlay");
        const at = (point) => ({
          pointerType: "touch",
          pointerId: 7,
          button: 0,
          isPrimary: true,
          clientX: point[0],
          clientY: point[1],
          bubbles: true,
        });
        await overlay.dispatchEvent("pointerdown", at(from));
        await overlay.dispatchEvent("pointermove", at(to));
        await overlay.dispatchEvent("pointerup", at(to));
      } else {
        await page.mouse.move(...from);
        await page.mouse.down();
        await page.mouse.move(...to, { steps: 6 });
        await page.mouse.up();
      }
      const ask = page.getByRole("button", {
        name: "Ask about this",
        exact: true,
      });
      await expect(ask).toBeVisible();
      await shot(page, `${size}-box`);
      await ask.click();
      await expect(
        page.getByRole("heading", { name: "Ask about page 3" }),
      ).toBeVisible();
      await expect(
        page.getByRole("img", { name: /The marked area of .*, page 3/ }),
      ).toBeVisible();
      await page
        .getByLabel("Post title")
        .fill("Why does x become y's left child?");
      await page.locator(".slide-panel .cm-content").click();
      await page.keyboard.type("Where does B move during the rotation?");
      await shot(page, `${size}-composer`);
      await page
        .locator(".slide-panel")
        .getByRole("button", { name: /^(Post|Publish)/ })
        .first()
        .click();
      const marker = page.getByRole("button", {
        name: "Question 1 on page 3: Why does x become y's left child?, unanswered",
      });
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute("aria-pressed", "true");
      await expect(
        page.getByRole("heading", { name: /^Page 3 questions/ }),
      ).toBeVisible();
      const sent = state.posts[0].anchor;
      expect(sent.page).toBe(3);
      expect(sent.box.x).toBeGreaterThan(0.5);
      expect(sent.box.x + sent.box.width).toBeLessThanOrEqual(1);
      await shot(page, `${size}-marker`);
      const overflow = await page
        .locator("html")
        .evaluate((html) => html.scrollWidth - html.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1536, height: 864 } });

  test("a deep link selects a question, and Discussion shows where it points", async ({
    page,
  }) => {
    const anchored = post(
      "019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a91",
      "Which rotation case is this?",
      anchorOn(3),
    );
    await mockApi(page, {
      questions: [
        {
          id: "019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a91",
          type: "question",
          title: anchored.title,
          page: 3,
          box,
          answered: true,
          unresolvedFollowups: 0,
          unread: false,
          createdAt: anchored.createdAt,
        },
      ],
      earlier: 2,
      posts: [
        anchored,
        post("019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a92", "Old slide question", {
          ...anchorOn(5),
          status: "earlier_version",
        }),
        post("019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a93", "Hidden slide question", {
          page: 2,
          box,
          status: "unavailable",
        }),
      ],
    });
    await page.goto(
      viewer("?page=3&post=019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a91"),
    );
    const marker = page.getByRole("button", {
      name: "Question 1 on page 3: Which rotation case is this?, answered",
    });
    await expect(marker).toHaveAttribute("aria-pressed", "true", {
      timeout: 30000,
    });
    await expect(
      page.getByText(
        "2 questions were asked on an earlier version of these slides.",
      ),
    ).toBeVisible();
    await renderedPages(page);
    await shot(page, "desktop-deep-link");

    await page.getByRole("link", { name: "Open in Discussion" }).click();
    await expect(page).toHaveURL(
      /\/posts\/019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a91$/,
    );
    const crop = page.getByRole("img", {
      name: `The asked-about area of ${resource.title}, page 3`,
    });
    await expect(crop).toBeVisible();
    await expect
      .poll(() => crop.locator("canvas").evaluate((canvas) => canvas.width))
      .toBeGreaterThan(0);
    const listings = page.getByRole("region", { name: "Post listings" });
    await expect(listings.getByText(`${resource.title} · p. 3`)).toBeVisible();
    await expect(
      listings.getByText(`${resource.title} · p. 5 · earlier version`),
    ).toBeVisible();
    await expect(listings.getByText("Slides unavailable")).toBeVisible();
    await shot(page, "desktop-discussion-crop");

    await page.getByRole("link", { name: "View on slides" }).click();
    await expect(page).toHaveURL(
      /\/resources\/slides\/view\?page=3&post=019a3c1e-7d2a-7b3e-9f10-2c4d5e6f7a91$/,
    );
    await expect(marker).toHaveAttribute("aria-pressed", "true");
  });
});
