// End-to-end live session against the running development stack
// (`npm run dev`).
// Seed isolation setup: documentation/testing.md.
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL to the running stack's database");

// Line text without remote cursor widgets, which render inside the lines.
const editorText = (page) =>
  page.locator(".cm-content").evaluate((element) =>
    [...element.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true);
        for (const widget of copy.querySelectorAll(".cm-ySelectionCaret"))
          widget.remove();
        return copy.textContent;
      })
      .join("\n"),
  );

test("a student and a TA edit, see each other, and end a live session", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);

  // The student starts a course session and invites the TA.
  await student.page.goto(`${BASE}/courses/${courseId}/collaboration`);
  await student.page
    .getByRole("button", { name: "Start live session" })
    .click();
  await student.page.getByLabel("Title").fill("Python pairing");
  await student.page.getByLabel("Language").selectOption("python");
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  await expect(student.page.getByRole("status")).toHaveText("Connected");
  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page
    .getByLabel("Invite a course member")
    .selectOption({ label: `${people.ta.name} (TA)` });
  await student.page.getByRole("button", { name: "Invite" }).click();
  await expect(
    student.page.locator(".session-participants").getByText(people.ta.name),
  ).toBeVisible();

  // The TA opens the same session.
  await ta.page.goto(sessionUrl);
  await expect(ta.page.getByRole("status")).toHaveText("Connected");

  // Both type at once; both editors converge on text containing both edits.
  await student.page.locator(".cm-content").click();
  await ta.page.locator(".cm-content").click();
  await Promise.all([
    student.page.keyboard.type("while True:\n"),
    ta.page.keyboard.type("# TA: add a break\n"),
  ]);
  await expect
    .poll(async () => {
      const [mine, theirs] = await Promise.all([
        editorText(student.page),
        editorText(ta.page),
      ]);
      return (
        mine === theirs &&
        mine.includes("while True:") &&
        mine.includes("# TA: add a break")
      );
    })
    .toBe(true);

  // Each sees the other's cursor labelled with their real name.
  await student.page.keyboard.type("x");
  await ta.page.keyboard.type("y");
  await expect(
    ta.page.locator(".cm-ySelectionInfo", { hasText: people.student.name }),
  ).toHaveCount(1);
  await expect(
    student.page.locator(".cm-ySelectionInfo", { hasText: people.ta.name }),
  ).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await editorText(student.page)) === (await editorText(ta.page)),
    )
    .toBe(true);
  const finalText = await editorText(ta.page);
  await Promise.all([
    student.page.screenshot({
      path: testInfo.outputPath("student-concurrent-edit.png"),
    }),
    ta.page.screenshot({ path: testInfo.outputPath("ta-concurrent-edit.png") }),
  ]);

  // The TA ends the session; both editors become read-only with the final text.
  await ta.page.getByRole("button", { name: "End session" }).click();
  const confirmation = ta.page.getByRole("dialog", { name: "Confirm action" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm" }).click();
  for (const { page } of [ta, student]) {
    await expect(page.locator(".session-state")).toHaveText(
      "Session ended (read-only)",
    );
    await expect(page.locator(".cm-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await expect.poll(() => editorText(page)).toBe(finalText);
  }
  await Promise.all([
    student.page.screenshot({ path: testInfo.outputPath("student-ended.png") }),
    ta.page.screenshot({ path: testInfo.outputPath("ta-ended.png") }),
  ]);

  await student.context.close();
  await ta.context.close();
});
