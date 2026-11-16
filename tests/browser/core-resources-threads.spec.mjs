import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { expect, test } from "@playwright/test";
import { BASE, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.beforeAll(() => {
  if (!process.env.E2E_DATABASE_URL || !process.env.E2E_DB_GUARD_TOKEN)
    throw new Error(
      "Core journeys require an explicit isolated E2E database and guard token",
    );
});

test("staff uploads a resource and a student downloads the same bytes", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed({ withInstructor: true });
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const content = `Core resource for ${courseId}\n`;
  await ta.page.goto(`${BASE}/courses/${courseId}/resources`);
  await ta.page.getByLabel("Choose a course file").setInputFiles({
    name: "core-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await ta.page.getByRole("button", { name: "Upload file" }).click();
  await expect(
    ta.page.getByRole("link", { name: "core-notes.txt" }),
  ).toBeVisible();
  await student.page.goto(`${BASE}/courses/${courseId}/resources`);
  const link = student.page.getByRole("link", { name: "core-notes.txt" });
  await expect(link).toBeVisible();
  await student.page.screenshot({
    path: testInfo.outputPath("resource-visible.png"),
  });
  const [download] = await Promise.all([
    student.page.waitForEvent("download"),
    link.click(),
  ]);
  expect(await readFile(await download.path(), "utf8")).toBe(content);
  await ta.context.close();
  await student.context.close();
});

test("staff creates a thread and two students exchange messages", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed({ withInstructor: true });
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const classmate = await signIn(browser, people.classmate);
  const title = `Core thread ${people.ta.id.slice(0, 8)}`;
  await ta.page.goto(`${BASE}/courses/${courseId}/threads`);
  await ta.page.getByRole("button", { name: "Create thread" }).click();
  await ta.page.getByRole("textbox", { name: "Thread title" }).fill(title);
  await ta.page.getByRole("button", { name: "Create", exact: true }).click();
  const board = ta.page.getByRole("link", { name: title });
  await expect(board).toBeVisible();
  await board.click();
  const boardUrl = ta.page.url();
  await student.page.goto(boardUrl);
  await student.page
    .getByRole("textbox", { name: "Start a conversation" })
    .fill("How should we prepare?");
  await student.page.getByRole("button", { name: "Post conversation" }).click();
  await student.page.waitForURL(/\/conversations\//);
  await expect(student.page.getByText("How should we prepare?")).toBeVisible();
  const conversationUrl = student.page.url();
  await classmate.page.goto(conversationUrl);
  await expect(
    classmate.page.getByText("How should we prepare?"),
  ).toBeVisible();
  await classmate.page
    .getByRole("textbox", { name: "Reply" })
    .fill("Read the first lecture notes.");
  await classmate.page
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  await student.page.reload();
  await expect(
    student.page.getByText("Read the first lecture notes."),
  ).toBeVisible();
  await student.page.screenshot({
    path: testInfo.outputPath("thread-exchange.png"),
  });
  await ta.context.close();
  await student.context.close();
  await classmate.context.close();
});

test("staff updates course information and exports statistics after student reads it", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed({ withInstructor: true });
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  await ta.page.goto(`${BASE}/courses/${courseId}/resources`);
  await ta.page.getByRole("tab", { name: "Course information" }).click();
  await ta.page
    .getByRole("button", { name: "Edit course information" })
    .click();
  await ta.page
    .getByRole("textbox", { name: "Course description" })
    .fill("Core course syllabus overview");
  await ta.page.getByRole("button", { name: "Save information" }).click();
  await expect(
    ta.page.getByText("Core course syllabus overview"),
  ).toBeVisible();
  await student.page.goto(`${BASE}/courses/${courseId}/resources`);
  await student.page.getByRole("tab", { name: "Course information" }).click();
  await expect(
    student.page.getByText("Core course syllabus overview"),
  ).toBeVisible();
  await student.page.screenshot({
    path: testInfo.outputPath("information-visible.png"),
  });
  await ta.page.goto(`${BASE}/courses/${courseId}/statistics`);
  await ta.page.getByRole("button", { name: "Activity" }).click();
  await expect(
    ta.page.getByRole("heading", { name: "Daily activity" }),
  ).toBeVisible();
  const [download] = await Promise.all([
    ta.page.waitForEvent("download"),
    ta.page
      .getByRole("button", { name: "Download daily activity CSV" })
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const [header, ...rows] = (await readFile(await download.path(), "utf8"))
    .trimEnd()
    .split("\r\n");
  expect(header).toBe("date,questions_created,answers_created,posts_viewed");
  expect(rows).toHaveLength(30);
  expect(
    rows.filter((row) => /^\d{4}-\d{2}-\d{2},1,0,0$/.test(row)),
  ).toHaveLength(1);
  await ta.page.screenshot({
    path: testInfo.outputPath("statistics-export.png"),
  });
  await ta.context.close();
  await student.context.close();
});
