import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import { expect, test } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screenshotDirectory =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(root, "docs/pr-screenshots/discussion-attachments");
const attachment = (id, fileName, mediaType) => ({
  id,
  fileName,
  mediaType,
  sizeBytes: 128,
  createdAt: "2026-10-18T00:00:00Z",
  downloadUrl: `/api/v1/attachments/${id}/download`,
});
const picture = attachment("image-1", "diagram.png", "image/png");
const document = attachment(
  "document-1",
  "lecture.pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
);
const post = (id, type, attachments = []) => ({
  id,
  courseId: "course-1",
  type,
  deleted: false,
  title: type === "question" ? "How does reflection work?" : "Lecture notes",
  bodyMarkdown: "Start with the **boundary** condition.",
  author: {
    userId: "u1",
    displayName: "Ada",
    anonymous: false,
    deleted: false,
  },
  anonymous: false,
  tags: [],
  attachments,
  createdAt: "2026-10-18T00:00:00Z",
  lastActivityAt: "2026-10-18T00:00:00Z",
  version: 1,
});
const answer = {
  id: "a1",
  postId: "p1",
  kind: "student",
  deleted: false,
  bodyMarkdown: "The angle is $\\theta$.",
  contributors: [{ id: "u1", displayName: "Ada" }],
  anonymous: false,
  attachments: [document],
  endorsedAt: null,
  endorsedBy: null,
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 1,
  viewerUpvoted: false,
};
const followup = {
  id: "f1",
  postId: "p1",
  parentId: null,
  author: { id: "u1", displayName: "Ada" },
  anonymous: false,
  bodyMarkdown: "Can you explain more?",
  deleted: false,
  attachments: [document],
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T00:00:00Z",
  version: 1,
  canEdit: true,
  upvoteCount: 0,
  viewerUpvoted: false,
  replyCount: 1,
};
const reply = {
  ...followup,
  id: "f2",
  parentId: "f1",
  bodyMarkdown: "See the attached slide.",
  replyCount: 0,
};
const png = readFileSync(
  resolve(root, "tests/browser/fixtures/attachment-diagram.png"),
);

test.describe("rendered discussion attachments", () => {
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

  async function mockApi(page, options = {}) {
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();
      if (path === picture.downloadUrl)
        return route.fulfill({
          status: 200,
          body: png,
          contentType: "image/png",
        });
      if (path === document.downloadUrl)
        return route.fulfill({
          status: 200,
          body: "presentation",
          contentType: document.mediaType,
          headers: {
            "Content-Disposition": "attachment; filename=lecture.pptx",
          },
        });
      const json = (data, status = 200) =>
        route.fulfill({ status, json: { data } });
      if (path === "/api/v1/courses/course-1/members/u1")
        return json({
          id: "m1",
          courseId: "course-1",
          user: { id: "u1", displayName: "Ada" },
          role: options.role ?? "student",
          createdAt: "2026-10-01T00:00:00Z",
          updatedAt: "2026-10-01T00:00:00Z",
          version: 1,
        });
      if (path === "/api/v1/courses/course-1/post-folders" && method === "GET")
        return json([]);
      if (path === "/api/v1/courses/course-1/posts" && method === "GET")
        return route.fulfill({
          json: {
            data: [
              post("p1", "question", [picture]),
              post("p2", "note", [picture]),
            ],
            page: { nextCursor: null, hasMore: false },
          },
        });
      if (path === "/api/v1/posts/p1" && method === "GET")
        return json(post("p1", "question", [picture]));
      if (path === "/api/v1/posts/p2" && method === "GET")
        return json(post("p2", "note", [picture]));
      if (path === "/api/v1/posts/p1/answers")
        return json([
          {
            ...answer,
            kind: options.answerKind ?? "student",
            canEdit: options.canEdit ?? true,
          },
        ]);
      if (path === "/api/v1/posts/p1/followups")
        return route.fulfill({
          json: {
            data: [{ ...followup, canEdit: options.canEdit ?? true }],
            meta: { total: 1, nextCursor: null },
          },
        });
      if (path === "/api/v1/followups/f1/replies")
        return route.fulfill({
          json: {
            data: [{ ...reply, canEdit: options.canEdit ?? true }],
            meta: { total: 1, nextCursor: null },
          },
        });
      if (path === "/api/v1/courses/course-1/collaboration-sessions")
        return route.fulfill({
          json: { data: [], page: { nextCursor: null, hasMore: false } },
        });
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "not_found", message: "fixture route missing" },
        },
      });
    });
  }

  test("question image and answer/followup documents render below their bodies", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    await expect(
      page.getByRole("heading", { name: "How does reflection work?" }),
    ).toBeVisible();
    const image = page.getByRole("img", { name: "diagram.png" });
    await expect(image).toBeVisible();
    await expect(page.getByRole("link", { name: "lecture.pptx" })).toHaveCount(
      2,
    );
    const imageBox = await image.boundingBox();
    const figureBox = await image.locator("xpath=..").boundingBox();
    expect(
      imageBox &&
        figureBox &&
        Math.abs(
          imageBox.x + imageBox.width / 2 - (figureBox.x + figureBox.width / 2),
        ),
    ).toBeLessThan(2);
    await page.screenshot({
      path: resolve(screenshotDirectory, "question-answer-followup.png"),
      fullPage: true,
    });
    const answerCard = page.getByRole("region", { name: "Answer by Ada" });
    await answerCard.scrollIntoViewIfNeeded();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      answerCard.getByRole("link", { name: "lecture.pptx" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("lecture.pptx");
    await answerCard.screenshot({
      path: resolve(screenshotDirectory, "answer-document.png"),
    });
    const followupCard = page.getByRole("article", { name: "Followup by Ada" });
    await followupCard.scrollIntoViewIfNeeded();
    await followupCard.screenshot({
      path: resolve(screenshotDirectory, "followup-document.png"),
    });
    await followupCard.getByRole("button", { name: "Show 1 replies" }).click();
    const replyCard = page.locator(".followup-replies > .followup-item");
    await expect(
      replyCard.getByRole("link", { name: "lecture.pptx" }),
    ).toBeVisible();
    await replyCard.screenshot({
      path: resolve(screenshotDirectory, "reply-document.png"),
    });
  });

  test("note image is available to a course member", async ({ page }) => {
    await mockApi(page);
    await page.goto(`${origin}/attachments-fixture.html?post=p2`);
    await expect(
      page.getByRole("heading", { name: "Lecture notes" }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "diagram.png" })).toBeVisible();
    await page.screenshot({
      path: resolve(screenshotDirectory, "note-image.png"),
      fullPage: true,
    });
  });

  test("created post survives an upload error and retries the same file without duplicate text", async ({
    page,
  }) => {
    await mockApi(page);
    let creates = 0;
    let uploads = 0;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === "/api/v1/courses/course-1/posts" && method === "POST") {
        creates++;
        return route.fulfill({
          status: 201,
          json: { data: post("p3", "note") },
        });
      }
      if (path === "/api/v1/posts/p3/attachments" && method === "POST") {
        uploads++;
        return uploads === 1
          ? route.fulfill({
              status: 503,
              json: {
                error: {
                  code: "storage_unavailable",
                  message: "Please retry this file",
                },
              },
            })
          : route.fulfill({ status: 201, json: { data: picture } });
      }
      if (path === "/api/v1/posts/p3" && method === "GET")
        return route.fulfill({ json: { data: post("p3", "note", [picture]) } });
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    await page.getByRole("button", { name: "Create post" }).click();
    await page
      .getByRole("combobox", { name: "Post type" })
      .selectOption("note");
    await page
      .getByRole("textbox", { name: "Post title" })
      .fill("Lecture notes");
    await page.getByRole("textbox", { name: "Post body" }).fill("New notes");
    await page.getByLabel("Add files").setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Publish post" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Please retry this file",
    );
    await page.screenshot({
      path: resolve(screenshotDirectory, "upload-retry-needed.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Retry attachments" }).click();
    await expect(page.getByRole("img", { name: "diagram.png" })).toBeVisible();
    expect(creates).toBe(1);
    expect(uploads).toBe(2);
    await page.screenshot({
      path: resolve(screenshotDirectory, "upload-recovered.png"),
      fullPage: true,
    });
  });

  test("a new followup uploads its document after its text is created", async ({
    page,
  }) => {
    await mockApi(page);
    let created = false;
    let uploaded = false;
    const newFollowup = {
      ...followup,
      id: "f3",
      bodyMarkdown: "Please review these slides",
      attachments: [],
      replyCount: 0,
    };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === "/api/v1/posts/p1/followups" && method === "GET")
        return route.fulfill({
          json: {
            data: created ? [newFollowup] : [],
            meta: { total: created ? 1 : 0, nextCursor: null },
          },
        });
      if (path === "/api/v1/posts/p1/followups" && method === "POST") {
        created = true;
        return route.fulfill({ status: 201, json: { data: newFollowup } });
      }
      if (path === "/api/v1/followups/f3/attachments" && method === "POST") {
        uploaded = true;
        return route.fulfill({ status: 201, json: { data: document } });
      }
      if (path === "/api/v1/followups/f3" && method === "GET")
        return route.fulfill({
          json: {
            data: { ...newFollowup, attachments: uploaded ? [document] : [] },
          },
        });
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    await page
      .getByRole("button", { name: "Compose a new followup discussion" })
      .click();
    const composer = page.locator(".response-composer");
    await composer
      .getByRole("textbox", { name: "Followup" })
      .fill("Please review these slides");
    await composer.getByLabel("Add files").setInputFiles({
      name: "lecture.pptx",
      mimeType: document.mediaType,
      buffer: Buffer.from("pptx"),
    });
    await composer.getByRole("button", { name: "Post followup" }).click();
    await expect(page.getByRole("link", { name: "lecture.pptx" })).toHaveCount(
      2,
    );
    expect(created).toBe(true);
    expect(uploaded).toBe(true);
    await page.getByRole("article", { name: "Followup by Ada" }).screenshot({
      path: resolve(screenshotDirectory, "created-followup-document.png"),
    });
  });

  test("a new shared answer uploads its image after its text is created", async ({
    page,
  }) => {
    await mockApi(page);
    let created = false;
    let uploaded = false;
    const newAnswer = {
      ...answer,
      attachments: [],
      bodyMarkdown: "A visual proof",
    };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === "/api/v1/posts/p1/answers" && method === "GET")
        return route.fulfill({ json: { data: created ? [newAnswer] : [] } });
      if (path === "/api/v1/posts/p1/answers" && method === "POST") {
        created = true;
        return route.fulfill({ status: 201, json: { data: newAnswer } });
      }
      if (path === "/api/v1/answers/a1/attachments" && method === "POST") {
        uploaded = true;
        return route.fulfill({ status: 201, json: { data: picture } });
      }
      if (path === "/api/v1/answers/a1" && method === "GET")
        return route.fulfill({
          json: {
            data: { ...newAnswer, attachments: uploaded ? [picture] : [] },
          },
        });
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    await page.getByRole("button", { name: "Start students' answer" }).click();
    const composer = page.locator(".response-composer");
    await composer
      .getByRole("textbox", { name: "Your answer" })
      .fill("A visual proof");
    await composer.getByLabel("Add files").setInputFiles({
      name: "diagram.png",
      mimeType: "image/png",
      buffer: png,
    });
    await composer.getByRole("button", { name: "Post answer" }).click();
    const card = page.getByRole("region", { name: "Answer by Ada" });
    await expect(card.getByRole("img", { name: "diagram.png" })).toBeVisible();
    expect(created).toBe(true);
    expect(uploaded).toBe(true);
    await card.screenshot({
      path: resolve(screenshotDirectory, "created-answer-image.png"),
    });
  });
  test("independent answer overwrite retains current images and document links", async ({
    page,
  }) => {
    await mockApi(page);
    let current = {
      ...answer,
      attachments: [picture],
      bodyMarkdown: "Original answer",
    };
    const patches = [];
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      if (path === "/api/v1/posts/p1/answers" && method === "GET")
        return route.fulfill({ json: { data: [current] } });
      if (path === "/api/v1/answers/a1" && method === "GET")
        return route.fulfill({ json: { data: current } });
      if (path === "/api/v1/answers/a1" && method === "PATCH") {
        patches.push({
          headers: route.request().headers(),
          body: route.request().postDataJSON(),
        });
        if (patches.length === 1) {
          current = {
            ...current,
            version: 2,
            bodyMarkdown: "A peer saved this correction",
            attachments: [picture, document],
          };
          return route.fulfill({
            status: 412,
            json: {
              error: { code: "version_conflict", message: "Answer changed" },
            },
          });
        }
        current = {
          ...current,
          version: 3,
          bodyMarkdown: patches[1].body.bodyMarkdown,
        };
        return route.fulfill({ json: { data: current } });
      }
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    const card = page.getByRole("region", { name: "Answer by Ada" });
    await card.getByRole("button", { name: "Edit answer" }).click();
    await card
      .getByRole("textbox", { name: "Answer", exact: true })
      .fill("My **saved proof** with $x^2$.");
    expect(patches).toHaveLength(0);
    await card.getByRole("button", { name: "Save answer" }).click();
    const conflict = card.getByRole("region", { name: "Answer conflict" });
    await expect(
      conflict.getByText("A peer saved this correction"),
    ).toBeVisible();
    await expect(
      conflict.getByRole("link", { name: "lecture.pptx" }),
    ).toBeVisible();
    await conflict.screenshot({
      path: resolve(screenshotDirectory, "answer-conflict-attachments.png"),
    });
    await conflict
      .getByRole("button", { name: "Overwrite with my draft" })
      .click();
    await expect(conflict).toHaveCount(0);
    await expect(card.locator("strong")).toHaveText("saved proof");
    await expect(card.locator(".katex")).toBeVisible();
    await expect(card.getByRole("img", { name: "diagram.png" })).toBeVisible();
    await expect(
      card.getByRole("link", { name: "lecture.pptx" }),
    ).toBeVisible();
    expect(patches[1].headers["if-match"]).toBe('"v2"');
    expect(patches[1].body).toEqual({
      bodyMarkdown: "My **saved proof** with $x^2$.",
    });
    await card.screenshot({
      path: resolve(screenshotDirectory, "answer-saved-attachments.png"),
    });
  });

  test("new reply uploads its document only after the reply is created", async ({
    page,
  }) => {
    await mockApi(page);
    let created = false;
    let uploaded = false;
    const newReply = {
      ...reply,
      id: "f3",
      bodyMarkdown: "My **reply**",
      attachments: [],
    };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname,
        method = route.request().method();
      if (path === "/api/v1/followups/f1/replies" && method === "POST") {
        created = true;
        return route.fulfill({ status: 201, json: { data: newReply } });
      }
      if (path === "/api/v1/followups/f3/attachments" && method === "POST") {
        expect(created).toBe(true);
        uploaded = true;
        return route.fulfill({ status: 201, json: { data: document } });
      }
      if (path === "/api/v1/followups/f3" && method === "GET")
        return route.fulfill({
          json: {
            data: {
              ...newReply,
              version: 2,
              attachments: uploaded ? [document] : [],
            },
          },
        });
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    const rootFollowup = page.getByRole("article", { name: "Followup by Ada" });
    await rootFollowup
      .getByRole("button", { name: "Reply", exact: true })
      .click();
    const composer = rootFollowup.locator(".response-composer");
    await composer
      .getByRole("textbox", { name: "Followup" })
      .fill("My **reply**");
    await composer.getByLabel("Add files").setInputFiles({
      name: "lecture.pptx",
      mimeType: document.mediaType,
      buffer: Buffer.from("browser-mocked-pptx"),
    });
    await composer.getByRole("button", { name: "Post reply" }).click();
    const newCard = page.locator(".followup-replies > .followup-item");
    await expect(
      newCard.getByRole("link", { name: "lecture.pptx" }),
    ).toBeVisible();
    await expect(newCard.locator("strong")).toHaveText("reply");
    expect(uploaded).toBe(true);
    await newCard.screenshot({
      path: resolve(screenshotDirectory, "created-reply-document.png"),
    });
  });

  test("an editor removes an answer file while archived members have read-only attachments", async ({
    page,
  }) => {
    await mockApi(page);
    let removed = false;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname,
        method = route.request().method();
      if (path === "/api/v1/attachments/document-1" && method === "DELETE") {
        removed = true;
        return route.fulfill({ status: 204 });
      }
      if (path === "/api/v1/answers/a1" && method === "GET")
        return route.fulfill({
          json: {
            data: {
              ...answer,
              version: 2,
              attachments: removed ? [] : [document],
            },
          },
        });
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p1`);
    const card = page.getByRole("region", { name: "Answer by Ada" });
    await expect(
      card.getByRole("button", { name: "Remove lecture.pptx" }),
    ).toHaveCount(0);
    await card.getByRole("button", { name: "Edit answer" }).click();
    await card.getByRole("button", { name: "Remove lecture.pptx" }).click();
    await expect(card.getByRole("link", { name: "lecture.pptx" })).toHaveCount(
      0,
    );
    expect(removed).toBe(true);
    await card.screenshot({
      path: resolve(screenshotDirectory, "edited-answer-document-removed.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${origin}/attachments-fixture.html?post=p2&status=archived`,
    );
    await expect(page.getByRole("img", { name: "diagram.png" })).toBeVisible();
    await expect(page.getByLabel("Add files")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove diagram.png" }),
    ).toHaveCount(0);
    const image = await page
      .getByRole("img", { name: "diagram.png" })
      .boundingBox();
    expect(image.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: resolve(screenshotDirectory, "archived-mobile-image.png"),
      fullPage: true,
    });
  });
  test("existing post keeps a failed sibling file after its successful image refresh", async ({
    page,
  }) => {
    await mockApi(page);
    let current = post("p2", "note", []);
    let reads = 0;
    let failSecond;
    const secondFailure = new Promise((resolve) => {
      failSecond = resolve;
    });
    const uploads = [];
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname,
        method = route.request().method();
      if (path === "/api/v1/posts/p2" && method === "GET") {
        if (++reads > 1) await delay(40);
        return route.fulfill({ json: { data: current } });
      }
      if (path === "/api/v1/posts/p2/attachments" && method === "POST") {
        uploads.push(route.request().headers()["idempotency-key"]);
        if (uploads.length === 2) {
          await secondFailure;
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: "service_unavailable",
                message: "Retry the slides",
              },
            },
          });
        }
        const file = uploads.length === 1 ? picture : document;
        current = {
          ...current,
          version: current.version + 1,
          attachments: [...current.attachments, file],
        };
        return route.fulfill({ status: 201, json: { data: file } });
      }
      return route.fallback();
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p2`);
    await page.getByRole("button", { name: "Edit post", exact: true }).click();
    await page.getByLabel("Add files").setInputFiles([
      { name: "diagram.png", mimeType: "image/png", buffer: png },
      {
        name: "lecture.pptx",
        mimeType: document.mediaType,
        buffer: Buffer.from("mocked-slides"),
      },
    ]);
    await page.getByRole("button", { name: "Save post" }).click();
    await expect(page.getByRole("img", { name: "diagram.png" })).toBeVisible();
    failSecond();
    await expect(page.getByRole("alert")).toContainText(
      "lecture.pptx: Retry the slides",
    );
    await page.screenshot({
      path: resolve(screenshotDirectory, "existing-post-partial-retry.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Retry attachments" }).click();
    await expect(
      page.getByRole("link", { name: "lecture.pptx" }),
    ).toBeVisible();
    expect(uploads).toHaveLength(3);
    expect(uploads[1]).toBe(uploads[2]);
    await page.screenshot({
      path: resolve(screenshotDirectory, "existing-post-recovered.png"),
      fullPage: true,
    });
  });
  test("selection rejects more than five files without uploading", async ({
    page,
  }) => {
    await mockApi(page);
    let uploads = 0;
    await page.route("**/api/v1/posts/p2/attachments", async (route) => {
      uploads++;
      return route.fulfill({
        status: 413,
        json: {
          error: { code: "payload_too_large", message: "Too many files" },
        },
      });
    });
    await page.goto(`${origin}/attachments-fixture.html?post=p2`);
    await page.getByRole("button", { name: "Edit post", exact: true }).click();
    await page.getByLabel("Add files").setInputFiles(
      Array.from({ length: 6 }, (_, index) => ({
        name: `image-${index}.png`,
        mimeType: "image/png",
        buffer: png,
      })),
    );
    await expect(page.getByRole("alert")).toContainText("at most five files");
    expect(uploads).toBe(0);
    await page.screenshot({
      path: resolve(screenshotDirectory, "five-file-limit.png"),
      fullPage: true,
    });
  });

  for (const [size, viewport] of [
    ["desktop", { width: 1440, height: 1080 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    test.describe(`${size} response authoring controls`, () => {
      test.use({ viewport });
      for (const [kind, role] of [
        ["student", "student"],
        ["staff", "ta"],
      ]) {
        test(`${kind} answer, root and reply expose files only in Edit`, async ({
          page,
        }) => {
          await mockApi(page, { answerKind: kind, role });
          await page.goto(`${origin}/attachments-fixture.html?post=p1`);
          const answerCard = page.getByRole("region", {
            name: "Answer by Ada",
          });
          const rootCard = page
            .getByRole("article", { name: "Followup by Ada" })
            .first();
          await rootCard
            .getByRole("button", { name: "Show 1 replies" })
            .click();
          const replyCard = page.locator(".followup-replies > .followup-item");
          for (const [card, editName] of [
            [answerCard, "Edit answer"],
            [rootCard, "Edit followup"],
            [replyCard, "Edit followup"],
          ]) {
            const attachments = card.locator(":scope > .content-attachments");
            await expect(
              attachments.getByRole("link", { name: "lecture.pptx" }),
            ).toBeVisible();
            await expect(attachments.getByLabel("Add files")).toHaveCount(0);
            await expect(
              attachments.getByRole("button", { name: "Remove lecture.pptx" }),
            ).toHaveCount(0);
            const edit = card
              .locator(":scope > .response-actions")
              .getByRole("button", { name: editName });
            const style = await edit.evaluate((node) => {
              const value = globalThis.getComputedStyle(node);
              return {
                radius: parseFloat(value.borderTopLeftRadius),
                padding: parseFloat(value.paddingLeft),
                color: value.color,
                background: value.backgroundColor,
                border: value.borderTopColor,
              };
            });
            expect(style.radius).toBeGreaterThanOrEqual(13);
            expect(style.padding).toBeGreaterThanOrEqual(20);
            expect(style.color).toBe("rgb(59, 102, 85)");
            expect(style.background).toBe("rgba(0, 0, 0, 0)");
            expect(style.border).toBe(style.color);
          }
          await page.screenshot({
            path: resolve(
              screenshotDirectory,
              `${size}-${kind}-response-view.png`,
            ),
            fullPage: true,
          });
          for (const [card, editName, label] of [
            [answerCard, "Edit answer", "answer"],
            [rootCard, "Edit followup", "root"],
            [replyCard, "Edit followup", "reply"],
          ]) {
            await card
              .locator(":scope > .response-actions")
              .getByRole("button", { name: editName })
              .click();
            const attachments = card.locator(":scope > .content-attachments");
            await expect(attachments.getByLabel("Add files")).toBeVisible();
            await expect(
              attachments.getByRole("button", { name: "Remove lecture.pptx" }),
            ).toBeVisible();
            await card.screenshot({
              path: resolve(
                screenshotDirectory,
                `${size}-${kind}-${label}-edit.png`,
              ),
            });
          }
          if (role === "ta") {
            const editStyle = await page
              .getByRole("button", { name: "Edit post" })
              .evaluate((node) => {
                const value = globalThis.getComputedStyle(node);
                return {
                  radius: parseFloat(value.borderTopLeftRadius),
                  padding: parseFloat(value.paddingLeft),
                  color: value.color,
                  background: value.backgroundColor,
                };
              });
            const pinStyle = await page
              .getByRole("button", { name: "Pin", exact: true })
              .evaluate((node) => {
                const value = globalThis.getComputedStyle(node);
                return {
                  color: value.color,
                  background: value.backgroundColor,
                };
              });
            expect(editStyle.radius).toBeGreaterThanOrEqual(13);
            expect(editStyle.padding).toBeGreaterThanOrEqual(20);
            expect(editStyle.color).toBe(pinStyle.color);
            expect(editStyle.background).toBe(pinStyle.background);
          }
        });
      }
      for (const [state, status, canEdit] of [
        ["archived", "archived", true],
        ["unauthorized", "active", false],
      ]) {
        test(`${state} responses retain links without file controls`, async ({
          page,
        }) => {
          await mockApi(page, { canEdit });
          await page.goto(
            `${origin}/attachments-fixture.html?post=p1&status=${status}`,
          );
          const rootCard = page
            .getByRole("article", { name: "Followup by Ada" })
            .first();
          await rootCard
            .getByRole("button", { name: "Show 1 replies" })
            .click();
          await expect(
            page.getByRole("link", { name: "lecture.pptx" }),
          ).toHaveCount(3);
          await expect(page.getByLabel("Add files")).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Remove lecture.pptx" }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Edit answer" }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("button", { name: "Edit followup" }),
          ).toHaveCount(0);
          await page.screenshot({
            path: resolve(
              screenshotDirectory,
              `${size}-${state}-responses-view.png`,
            ),
            fullPage: true,
          });
        });
      }
    });
  }
});
