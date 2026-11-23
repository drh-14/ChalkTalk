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

async function compose(page, courseId, type, title, body) {
  await page.goto(`${BASE}/courses/${courseId}`);
  await page
    .getByRole("button", { name: /^(?:Create post|New post)$/ })
    .click();
  await page.getByRole("combobox", { name: "Post type" }).selectOption(type);
  await page.getByRole("textbox", { name: "Post title" }).fill(title);
  await page.getByRole("textbox", { name: "Post body" }).fill(body);
}

test("account login and sign-out through the UI", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { people } = await seed({ withCourse: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByRole("button", { name: "Log in" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to ChalkTalk" });
  await dialog
    .getByRole("textbox", { name: "Email address" })
    .fill(people.student.email);
  await dialog
    .getByRole("textbox", { name: "Password" })
    .fill("live session e2e password");
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("account-signed-in.png") });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("account-signed-out.png"),
  });
  await context.close();
});

test("instructor creates a course and student joins with its code", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { people } = await seed({ withCourse: false });
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const name = `Core course ${people.ta.id.slice(0, 8)}`;
  await ta.page.goto(`${BASE}/home`);
  await ta.page.getByRole("button", { name: "Create course" }).click();
  await ta.page.getByRole("textbox", { name: "Course name" }).fill(name);
  await ta.page
    .locator(".course-form")
    .getByRole("button", { name: "Create course" })
    .click();
  await ta.page.waitForURL(/\/courses\/[0-9a-f-]+$/);
  const courseId = ta.page.url().split("/courses/")[1];
  await expect(ta.page.getByText(name).first()).toBeVisible();
  await ta.page.goto(`${BASE}/courses/${courseId}/settings`);
  const joinCode = await ta.page
    .getByText("Join code", { exact: true })
    .locator("..")
    .locator("code")
    .innerText();
  await ta.page.screenshot({ path: testInfo.outputPath("course-created.png") });

  await student.page.goto(`${BASE}/home`);
  await student.page.getByRole("button", { name: "Join a course" }).click();
  await student.page
    .getByRole("textbox", { name: "Course link ID" })
    .fill(courseId);
  await student.page.getByRole("textbox", { name: "Join code" }).fill(joinCode);
  await student.page
    .getByRole("button", { name: "Join course", exact: true })
    .click();
  await expect(student.page).toHaveURL(`${BASE}/courses/${courseId}`);
  await expect(student.page.getByText(name).first()).toBeVisible();
  await student.page.screenshot({
    path: testInfo.outputPath("course-joined.png"),
  });
  await ta.context.close();
  await student.context.close();
});

test("question publishes, receives an answer and followup, and survives reload", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const title = `Core question ${people.student.id.slice(0, 8)}`;
  await compose(
    student.page,
    courseId,
    "question",
    title,
    "How should this work?",
  );
  await student.page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    student.page.getByRole("heading", { name: title }),
  ).toBeVisible();
  const url = student.page.url();
  await student.page.screenshot({
    path: testInfo.outputPath("question-published.png"),
  });
  await ta.page.goto(url);
  await ta.page
    .getByRole("button", { name: "Start instructors' answer" })
    .click();
  await ta.page
    .getByRole("textbox", { name: "Your answer" })
    .fill("Use the documented approach.");
  await ta.page.getByRole("button", { name: "Post answer" }).click();
  await expect(ta.page.getByText("Use the documented approach.")).toBeVisible();
  await student.page.reload();
  await expect(
    student.page.getByText("Use the documented approach."),
  ).toBeVisible();
  await student.page
    .getByRole("button", { name: "Compose a new followup discussion" })
    .click();
  await student.page
    .getByRole("textbox", { name: "Followup" })
    .fill("That answers my question.");
  await student.page.getByRole("button", { name: "Post followup" }).click();
  await student.page.reload();
  await expect(
    student.page.getByText("That answers my question."),
  ).toBeVisible();
  await student.page.screenshot({
    path: testInfo.outputPath("question-discussion.png"),
  });
  await student.context.close();
  await ta.context.close();
});

test("note announcement publishes and is visible to a student", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { courseId, people } = await seed();
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const title = `Core announcement ${people.ta.id.slice(0, 8)}`;
  await compose(ta.page, courseId, "note", title, "Office hours have moved.");
  await ta.page
    .getByRole("checkbox", {
      name: "Post as announcement (pinned; email sent to subscribers)",
    })
    .check();
  await ta.page.getByRole("button", { name: "Publish post" }).click();
  await expect(ta.page.getByRole("heading", { name: title })).toBeVisible();
  await student.page.goto(`${BASE}/courses/${courseId}`);
  const card = student.page.locator(".post-card", { hasText: title });
  await expect(card).toContainText("Announcement");
  await student.page.screenshot({
    path: testInfo.outputPath("note-announcement.png"),
  });
  await ta.context.close();
  await student.context.close();
});

test("poll publishes, student votes, and vote persists", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const { courseId, people } = await seed();
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const title = `Core poll ${people.ta.id.slice(0, 8)}`;
  await compose(ta.page, courseId, "poll", title, "Choose one option.");
  await ta.page.getByRole("textbox", { name: "Option 1" }).fill("Monday");
  await ta.page.getByRole("textbox", { name: "Option 2" }).fill("Tuesday");
  await ta.page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    ta.page.getByRole("heading", { name: "Poll · 0 votes" }),
  ).toBeVisible();
  const url = ta.page.url();
  await student.page.goto(url);
  const poll = student.page.locator(".poll-card");
  await poll.getByRole("radio", { name: "Tuesday" }).check();
  await poll.getByRole("button", { name: "Vote" }).click();
  await expect(poll.getByRole("heading")).toHaveText("Poll · 1 vote");
  await student.page.reload();
  await expect(student.page.locator(".poll-card li.selected")).toContainText(
    "Tuesday · your vote",
  );
  await student.page.screenshot({
    path: testInfo.outputPath("poll-voted.png"),
  });
  await ta.context.close();
  await student.context.close();
});
