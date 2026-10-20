// End-to-end session whiteboard against the running development stack
// (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/session-whiteboard");
mkdirSync(screenshots, { recursive: true });
const own = new URL(BASE).hostname;
// ChalkTalk's own interface fonts, which every page loads; not the whiteboard's.
const interfaceFontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** Records requests to any host other than ChalkTalk, and local font loads. */
function watch(page) {
  const record = { watching: false, external: [], fonts: [] };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.protocol.startsWith("http") && !url.protocol.startsWith("ws")) return;
    if (record.watching && url.hostname !== own && !interfaceFontHosts.has(url.hostname))
      record.external.push(request.url());
  });
  page.on("response", (response) => {
    if (response.url().includes("/excalidraw-assets/fonts/") && response.ok())
      record.fonts.push(response.url());
  });
  return record;
}

const summary = (page) => page.locator(".session-whiteboard-summary");
const state = (page) => page.locator(".session-state");

async function drag(page, tool, [x1, y1], [x2, y2]) {
  await page.locator(`label:has([data-testid="toolbar-${tool}"])`).click();
  const box = await page.locator(".excalidraw__canvas.interactive").boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
}

test("a student and a TA draw on the session whiteboard at once, then it becomes read-only", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const studentRequests = watch(student.page);
  const taRequests = watch(ta.page);

  await student.page.goto(`${BASE}/courses/${courseId}/posts/${postId}`);
  await student.page.getByRole("button", { name: "Start live session" }).click();
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  const sessionId = sessionUrl.split("/sessions/")[1];
  await expect(state(student.page)).toHaveText("Connected");
  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page.getByLabel("Invite a course member").selectOption({ label: `${people.ta.name} (TA)` });
  await student.page.getByRole("button", { name: "Invite" }).click();
  await expect(student.page.locator(".session-participants").getByText(people.ta.name)).toBeVisible();
  await ta.page.goto(sessionUrl);
  await expect(state(ta.page)).toHaveText("Connected");

  // Both open the whiteboard; its code loads only now.
  studentRequests.watching = taRequests.watching = true;
  for (const { page } of [student, ta]) {
    await page.getByRole("tab", { name: "Whiteboard" }).click();
    await expect(page.getByTestId("toolbar-rectangle")).toBeVisible({ timeout: 30_000 });
    await expect(summary(page)).toHaveText("Whiteboard is empty");
    // The library browser and AI tools reach third-party services.
    await expect(page.locator(".default-sidebar-trigger")).toBeHidden();
    await expect(page.locator(".App-toolbar__extra-tools-trigger")).toBeHidden();
  }

  // They draw different shapes at the same time; each sees both.
  await Promise.all([
    drag(student.page, "rectangle", [120, 120], [260, 200]),
    drag(ta.page, "arrow", [340, 140], [480, 240]),
  ]);
  for (const { page } of [student, ta])
    await expect(summary(page)).toHaveText("Whiteboard has 1 rectangle and 1 arrow");

  // The TA sees the student's pointer, named and colored as in the participant list.
  const canvas = await student.page.locator(".excalidraw__canvas.interactive").boundingBox();
  await student.page.mouse.move(canvas.x + 300, canvas.y + 320, { steps: 4 });
  const studentPointer = ta.page.locator(`.session-pointer[data-name="${people.student.name}"]`);
  await expect(studentPointer).toBeVisible();
  const avatarColor = await ta.page
    .locator(".session-participants li", { hasText: people.student.name })
    .locator(".session-avatar")
    .evaluate((element) => element.ownerDocument.defaultView.getComputedStyle(element).backgroundColor);
  await expect(studentPointer).toHaveCSS("color", avatarColor);

  // The TA labels the diagram; the text renders with fonts served by ChalkTalk.
  await ta.page.locator(`label:has([data-testid="toolbar-text"])`).click();
  const box = await ta.page.locator(".excalidraw__canvas.interactive").boundingBox();
  await ta.page.mouse.click(box.x + 140, box.y + 300);
  await ta.page.keyboard.type("loop exits here");
  await ta.page.keyboard.press("Escape");
  await expect(summary(student.page)).toHaveText(
    "Whiteboard has 1 rectangle, 1 arrow and 1 text box",
  );
  await expect.poll(() => taRequests.fonts.length).toBeGreaterThan(0);
  await student.page.screenshot({ path: resolve(screenshots, "student-sees-both-drawings.png") });
  await ta.page.screenshot({ path: resolve(screenshots, "ta-whiteboard.png") });

  // Switching to the code tab and back keeps the connection and the drawing.
  await student.page.getByRole("tab", { name: "Code" }).click();
  await expect(student.page.locator(".cm-content")).toBeVisible();
  await student.page.screenshot({ path: resolve(screenshots, "code-tab.png") });
  await student.page.getByRole("tab", { name: "Whiteboard" }).click();
  await expect(state(student.page)).toHaveText("Connected");
  await expect(summary(student.page)).toHaveText(
    "Whiteboard has 1 rectangle, 1 arrow and 1 text box",
  );

  // The TA ends the session; the board stays visible but can't be edited.
  ta.page.once("dialog", (dialog) => void dialog.accept());
  await ta.page.getByRole("button", { name: "End session" }).click();
  for (const { page } of [ta, student]) {
    await expect(state(page)).toHaveText("Session ended (read-only)");
    await expect(summary(page)).toHaveText(
      "Whiteboard has 1 rectangle, 1 arrow and 1 text box",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("toolbar-rectangle")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export PNG" })).toBeEnabled();
  }
  await student.page.screenshot({ path: resolve(screenshots, "ended-read-only.png") });

  const snapshot = await student.page.request.get(
    `${BASE}/api/v1/collaboration-sessions/${sessionId}/snapshot`,
  );
  expect(snapshot.status()).toBe(200);
  const elements = (await snapshot.json()).data.whiteboard;
  expect(elements.map((element) => element.type).sort()).toEqual(["arrow", "rectangle", "text"]);

  // Export downloads a PNG named after the session.
  const [download] = await Promise.all([
    student.page.waitForEvent("download"),
    student.page.getByRole("button", { name: "Export PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("my-loop-never-stops-whiteboard.png");

  expect(studentRequests.external).toEqual([]);
  expect(taRequests.external).toEqual([]);
  await student.context.close();
  await ta.context.close();
});
