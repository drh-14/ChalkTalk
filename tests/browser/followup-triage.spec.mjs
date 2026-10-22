// End-to-end followup triage against the running development stack
// (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/followup-triage");
mkdirSync(screenshots, { recursive: true });

test("a TA clears a discussion from the Unresolved queue and a student's reply reopens it", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const title = "My loop never stops";
  const question = `${BASE}/courses/${courseId}/posts/${postId}`;

  // The student asks a followup on their seeded question.
  await student.page.goto(question);
  await student.page.getByRole("button", { name: "Compose a new followup discussion" }).click();
  await student.page.getByRole("textbox", { name: "Followup" }).fill("It still loops after adding a break.");
  await student.page.getByRole("button", { name: "Post followup" }).click();
  const discussion = (page) =>
    page.getByRole("article", { name: new RegExp(`Followup by ${people.student.name}`) }).first();
  await expect(discussion(student.page)).toContainText("It still loops after adding a break.");

  // The TA finds it under Unresolved.
  await ta.page.goto(`${BASE}/courses/${courseId}?filter=unresolved`);
  const card = ta.page.locator(".post-card", { hasText: title });
  await expect(card).toContainText("1 unresolved", { timeout: 20_000 });
  await ta.page.screenshot({ path: resolve(screenshots, "unresolved-queue.png") });
  await card.click();
  const status = discussion(ta.page).getByRole("group", { name: "Discussion status" });
  await expect(status.getByRole("button", { name: "Unresolved", exact: true })).toHaveAttribute("aria-pressed", "true", {
    timeout: 20_000,
  });
  await status.getByRole("button", { name: "Resolved", exact: true }).click();
  await expect(status.getByRole("button", { name: "Resolved", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card).not.toContainText("unresolved");
  await ta.page.screenshot({ path: resolve(screenshots, "ta-resolved.png") });

  // The question leaves the queue.
  await ta.page.goto(`${BASE}/courses/${courseId}?filter=unresolved`);
  await expect(ta.page.getByText("No posts found.")).toBeVisible({ timeout: 20_000 });

  // The student replies, which reopens the discussion.
  await student.page.goto(question);
  await expect(discussion(student.page).locator(".discussion-status-control")).toBeVisible();
  await discussion(student.page).getByRole("button", { name: "Reply" }).click();
  await discussion(student.page).getByRole("textbox", { name: "Followup" }).fill("Never mind, it still loops.");
  await discussion(student.page).getByRole("button", { name: "Post reply" }).click();
  await expect(
    discussion(student.page)
      .getByRole("group", { name: "Discussion status" })
      .getByRole("button", { name: "Unresolved", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await student.page.screenshot({ path: resolve(screenshots, "student-reopened.png") });

  await ta.page.goto(`${BASE}/courses/${courseId}?filter=unresolved`);
  await expect(ta.page.locator(".post-card", { hasText: title })).toContainText("1 unresolved", {
    timeout: 20_000,
  });

  await student.context.close();
  await ta.context.close();
});
