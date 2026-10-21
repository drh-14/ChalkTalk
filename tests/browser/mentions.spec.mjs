// End-to-end @mentions against the running development stack (`npm run dev`).
// It seeds its own course and accounts directly in the database named by
// E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/mentions");
mkdirSync(screenshots, { recursive: true });

test("a student mentions a TA in a followup and the TA is notified", async ({ browser }) => {
  test.setTimeout(150_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const question = `${BASE}/courses/${courseId}/posts/${postId}`;
  const firstName = people.ta.name.split(" ")[0];

  // The student picks the TA from the @ suggestions.
  await student.page.goto(question);
  await student.page.getByRole("button", { name: "Compose a new followup discussion" }).click();
  const editor = student.page.getByRole("textbox", { name: "Followup" });
  await editor.click();
  await student.page.keyboard.type(`Could @${firstName.slice(0, 3)}`);
  const option = student.page.getByRole("option", { name: new RegExp(`@${people.ta.name}`) });
  await expect(option).toBeVisible({ timeout: 20_000 });
  await student.page.screenshot({ path: resolve(screenshots, "suggestions.png") });
  await option.click();
  await student.page.keyboard.type("take a look?");
  await student.page.getByRole("button", { name: "Post followup" }).click();

  // The mention renders as a highlighted name, not a link.
  const mention = student.page.locator(".followup-item .mention", { hasText: `@${people.ta.name}` });
  await expect(mention).toBeVisible();
  await expect(student.page.locator(".followup-item a", { hasText: people.ta.name })).toHaveCount(0);
  await student.page.screenshot({ path: resolve(screenshots, "mention-rendered.png") });

  // The TA sees the mention in the bell and opens the question.
  await ta.page.goto(`${BASE}/courses/${courseId}`);
  const bell = ta.page.getByRole("button", { name: /Notifications, \d+ unread/ });
  await expect(bell).toBeVisible({ timeout: 20_000 });
  await bell.click();
  const item = ta.page
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: new RegExp(`${people.student.name} mentioned you on`) });
  await expect(item).toBeVisible();
  await ta.page.screenshot({ path: resolve(screenshots, "ta-bell.png") });
  await item.click();
  await expect(ta.page).toHaveURL(new RegExp(`/posts/${postId}`));
  await expect(ta.page.locator(".followup-item .mention")).toBeVisible({ timeout: 20_000 });

  await student.context.close();
  await ta.context.close();
});
