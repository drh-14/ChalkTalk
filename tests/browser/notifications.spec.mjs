// End-to-end notifications against the running development stack
// (`npm run dev`, with the job worker and Mailpit). It seeds its own course and
// accounts directly in the database named by E2E_DATABASE_URL (or DATABASE_URL)
// and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(
  !databaseUrl,
  "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database",
);

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const screenshots = resolve(
  import.meta.dirname,
  "../../docs/pr-screenshots/notifications",
);
mkdirSync(screenshots, { recursive: true });

test("a student follows their question, sees a TA's answer in the bell, feed, and email, and opens it", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const title = "Why does my recursion never end?";

  // The student opts in to activity emails.
  await student.page.goto(`${BASE}/courses/${courseId}/settings`);
  const emails = student.page.getByRole("checkbox", {
    name: "Activity emails on followed posts",
  });
  await emails.check();
  await expect(student.page.getByText("Email preference saved")).toBeVisible();
  await student.page.screenshot({
    path: resolve(screenshots, "course-setting.png"),
  });

  // The student asks and follows the question automatically.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await student.page.getByRole("button", { name: "Create post" }).click();
  await student.page.getByRole("textbox", { name: "Post title" }).fill(title);
  await student.page.getByRole("textbox", { name: "Post body" }).click();
  await student.page.keyboard.type("It keeps calling itself.");
  await student.page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    student.page.getByRole("heading", { name: title }),
  ).toBeVisible();
  await expect(
    student.page.getByRole("button", { name: "Following" }),
  ).toBeVisible();
  await student.page.screenshot({
    path: resolve(screenshots, "following.png"),
  });

  // The TA answers.
  await ta.page.goto(`${BASE}/courses/${courseId}`);
  await ta.page.getByText(title).first().click();
  await expect(
    ta.page.getByRole("button", { name: "Follow", exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await ta.page
    .getByRole("button", { name: "Start instructors' answer" })
    .click();
  await ta.page
    .getByRole("textbox", { name: "Your answer" })
    .fill("Add a base case.");
  await ta.page.getByRole("button", { name: "Post answer" }).click();
  await expect(ta.page.getByText("Add a base case.")).toBeVisible();
  // Answering follows the post for the TA too.
  await expect(
    ta.page.getByRole("button", { name: "Following" }),
  ).toBeVisible();

  // The opted-in student is emailed while the notification is unread.
  await expect
    .poll(
      async () => {
        const search = await student.page.request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${people.student.email}" subject:"New answer on"`)}`,
        );
        return (await search.json()).messages?.length ?? 0;
      },
      { timeout: 60_000 },
    )
    .toBe(1);

  // The bell and the feed show the answer.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  const bell = student.page.getByRole("button", {
    name: "Notifications, 1 unread",
  });
  await expect(bell).toBeVisible();
  const card = student.page.locator(".post-card", { hasText: title });
  await expect(card).toHaveClass(/unread/);
  await student.page.screenshot({
    path: resolve(screenshots, "feed-unread.png"),
  });
  await bell.click();
  const panel = student.page.getByRole("region", { name: "Notifications" });
  const item = panel.getByRole("button", {
    name: new RegExp(`${people.ta.name} answered`),
  });
  await expect(item).toContainText(title);
  await student.page.screenshot({
    path: resolve(screenshots, "bell-panel.png"),
  });

  // Choosing it opens the question and clears both markers.
  await item.click();
  await expect(student.page).toHaveURL(/\/posts\//);
  await expect(
    student.page.getByRole("heading", { name: title }),
  ).toBeVisible();
  await expect(student.page.getByText("Add a base case.")).toBeVisible();
  await expect(
    student.page.getByRole("button", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await expect(
    student.page.locator(".post-card", { hasText: title }),
  ).not.toHaveClass(/unread/);
  await student.page.screenshot({
    path: resolve(screenshots, "after-opening.png"),
  });

  await student.context.close();
  await ta.context.close();
});
