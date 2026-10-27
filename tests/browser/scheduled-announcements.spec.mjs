// End-to-end scheduled announcements against the running development stack
// (`npm run dev`, with the job worker). It seeds its own course and accounts
// directly in the database named by E2E_DATABASE_URL (or DATABASE_URL) and is
// skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/scheduled-announcements");
mkdirSync(screenshots, { recursive: true });

/**
 * A datetime-local value about two minutes ahead, in local time. The input drops
 * seconds, so this stays more than the required minute ahead.
 */
function soon() {
  const when = new Date(Date.now() + 125_000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

test("a TA schedules an announcement that students only see once it publishes", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { courseId, people } = await seed();
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);
  const title = "Midterm room change";

  // The TA writes the announcement and schedules it.
  await ta.page.goto(`${BASE}/courses/${courseId}`);
  await ta.page.getByRole("button", { name: "Create post" }).click();
  await ta.page.getByRole("combobox", { name: "Post type" }).selectOption("note");
  await ta.page.getByRole("textbox", { name: "Post title" }).fill(title);
  await ta.page.getByRole("textbox", { name: "Post body" }).click();
  await ta.page.keyboard.type("We will meet in Room 204.");
  await ta.page
    .getByRole("checkbox", { name: "Post as announcement (pinned and emailed to the class)" })
    .check();
  const publish = ta.page.getByRole("group", { name: "Publish" });
  await publish.getByRole("radio", { name: "Later" }).check();
  await ta.page.getByLabel("Publish at").fill(soon());
  await ta.page.screenshot({ path: resolve(screenshots, "compose-scheduled.png") });
  await ta.page.getByRole("button", { name: "Publish post" }).click();
  await expect(ta.page.getByText(/Scheduled to publish/)).toBeVisible({ timeout: 20_000 });
  await expect(ta.page.locator(".post-card", { hasText: title })).toContainText("Scheduled ·");
  await ta.page.screenshot({ path: resolve(screenshots, "staff-scheduled.png") });

  // The student cannot see it yet.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await expect(student.page.locator(".post-card").first()).toBeVisible();
  await expect(student.page.locator(".post-card", { hasText: title })).toHaveCount(0);

  // Once the worker publishes it, it is pinned at the top and announced.
  await expect
    .poll(
      async () => {
        await student.page.goto(`${BASE}/courses/${courseId}`);
        await student.page.locator(".post-card").first().waitFor();
        return student.page.locator(".post-card", { hasText: title }).count();
      },
      { timeout: 180_000, intervals: [10_000] },
    )
    .toBe(1);
  const card = student.page.locator(".post-card").first();
  await expect(card).toContainText(title);
  await expect(card).toContainText("Announcement");
  await expect(card).not.toContainText("Scheduled");
  await expect(student.page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();
  await student.page.screenshot({ path: resolve(screenshots, "student-published.png") });

  await ta.context.close();
  await student.context.close();
});
