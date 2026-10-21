// End-to-end live session viewer and posting against the running development
// stack (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/session-viewers");
mkdirSync(screenshots, { recursive: true });

const editorText = (page) =>
  page.locator(".cm-content").evaluate((element) =>
    [...element.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true);
        for (const widget of copy.querySelectorAll(".cm-ySelectionCaret")) widget.remove();
        return copy.textContent;
      })
      .join("\n"),
  );

test("a viewer follows along without editing, and the code is posted to the question", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const viewer = await signIn(browser, people.classmate);

  await student.page.goto(`${BASE}/courses/${courseId}/posts/${postId}`);
  await student.page.getByRole("button", { name: "Start live session" }).click();
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page
    .getByLabel("Invite a course member")
    .selectOption({ label: `${people.classmate.name} (student)` });
  await student.page.getByRole("radio", { name: "Can view" }).click();
  await student.page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(
    student.page.locator(".session-participants li", { hasText: people.classmate.name }),
  ).toContainText("Invited · Viewer");

  // The viewer joins read-only and follows the student's typing.
  await viewer.page.goto(sessionUrl);
  await expect(viewer.page.locator(".session-state")).toHaveText("Connected");
  await expect(viewer.page.getByText("View only")).toBeVisible();
  await expect(viewer.page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await expect(viewer.page.getByRole("button", { name: "Post to discussion" })).toHaveCount(0);
  await student.page.locator(".cm-content").click();
  await student.page.keyboard.type("while True:\n    break");
  await expect.poll(() => editorText(viewer.page)).toBe("while True:\n    break");
  await viewer.page.locator(".cm-content").click();
  await viewer.page.keyboard.type("oops");
  await expect.poll(() => editorText(student.page)).toBe("while True:\n    break");
  await viewer.page.screenshot({ path: resolve(screenshots, "viewer-read-only.png") });

  // The student posts the code to the question as a followup.
  await student.page.getByRole("button", { name: "Post to discussion" }).click();
  const dialog = student.page.getByRole("dialog", { name: "Post code to the discussion" });
  await dialog.getByLabel("Note (optional)").fill("We fixed the loop together.");
  await student.page.screenshot({ path: resolve(screenshots, "post-code-dialog.png") });
  await dialog.getByRole("button", { name: "Post" }).click();
  await dialog.getByRole("link", { name: "View the post" }).click();
  await student.page.waitForURL(new RegExp(`/posts/${postId}`));
  await expect(student.page.getByText("We fixed the loop together.")).toBeVisible();
  await expect(student.page.locator("pre code", { hasText: "while True:" })).toBeVisible();
  await student.page.screenshot({ path: resolve(screenshots, "posted-followup.png") });

  await student.context.close();
  await viewer.context.close();
});
