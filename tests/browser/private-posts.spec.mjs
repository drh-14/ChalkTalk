// End-to-end private posts against the running development stack
// (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/private-posts");
mkdirSync(screenshots, { recursive: true });

test("a student asks staff privately, a classmate cannot find it, and a TA answers and makes it public", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const classmate = await signIn(browser, people.classmate);
  const ta = await signIn(browser, people.ta);
  const title = "Was problem 2 on lab 3 graded correctly?";
  const feed = (page) => page.locator(".post-card", { hasText: title });

  // The student posts privately and anonymously.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await student.page.getByRole("button", { name: "Create post" }).click();
  await student.page.getByRole("combobox", { name: "Post to" }).selectOption("staff");
  await student.page.getByRole("checkbox", { name: "Post anonymously" }).check();
  await student.page.getByRole("textbox", { name: "Post title" }).fill(title);
  await student.page.getByRole("textbox", { name: "Post body" }).click();
  await student.page.keyboard.type("I think my answer matched the rubric.");
  await student.page.screenshot({ path: resolve(screenshots, "compose-private.png") });
  await student.page.getByRole("button", { name: "Publish post" }).click();
  await expect(student.page.getByRole("heading", { name: title })).toBeVisible();
  await expect(student.page.getByText("Only you and course staff can see this.")).toBeVisible();
  await expect(feed(student.page)).toContainText("Private");
  await student.page.screenshot({ path: resolve(screenshots, "student-private-post.png") });

  // A classmate finds it neither in the feed nor by searching.
  await classmate.page.goto(`${BASE}/courses/${courseId}`);
  await expect(classmate.page.locator(".post-card").first()).toBeVisible();
  await expect(feed(classmate.page)).toHaveCount(0);
  await classmate.page.getByRole("searchbox", { name: "Search posts" }).fill("lab 3 graded");
  await classmate.page.getByRole("searchbox", { name: "Search posts" }).press("Enter");
  await expect(classmate.page.getByText("No posts found.")).toBeVisible({ timeout: 15_000 });
  await classmate.page.screenshot({ path: resolve(screenshots, "classmate-search.png") });

  // The TA sees it with the badge, answers, and makes it public.
  await ta.page.goto(`${BASE}/courses/${courseId}`);
  await expect(feed(ta.page)).toContainText("Private");
  await feed(ta.page).click();
  await expect(ta.page.getByRole("heading", { name: title })).toBeVisible({ timeout: 20_000 });
  await ta.page.getByRole("button", { name: "Start instructors' answer" }).click();
  await ta.page.getByRole("textbox", { name: "Your answer" }).fill("Yes; the rubric allowed either form.");
  await ta.page.getByRole("button", { name: "Post answer" }).click();
  await expect(ta.page.getByText("Yes; the rubric allowed either form.")).toBeVisible();
  await expect(ta.page.getByRole("button", { name: "Post answer" })).toHaveCount(0);
  await ta.page.getByRole("heading", { name: title }).scrollIntoViewIfNeeded();
  await expect(ta.page.getByText("Only the author and course staff can see this.")).toBeVisible();
  await ta.page.screenshot({ path: resolve(screenshots, "ta-private-post.png") });
  ta.page.once("dialog", (dialog) => dialog.accept());
  await ta.page.getByRole("button", { name: "Make public" }).click();
  await expect(ta.page.getByText("Only the author and course staff can see this.")).toHaveCount(0);

  // The classmate now finds it, still anonymous.
  await classmate.page.goto(`${BASE}/courses/${courseId}`);
  await expect(feed(classmate.page)).toBeVisible();
  await expect(feed(classmate.page)).toContainText("Anonymous");
  await expect(feed(classmate.page)).not.toContainText("Private");
  await classmate.page.screenshot({ path: resolve(screenshots, "classmate-after-public.png") });

  // The student is told about the answer and that it is public.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  const bell = student.page.getByRole("button", { name: "Notifications, 2 unread" });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(
    student.page.getByRole("region", { name: "Notifications" }).getByText(/made your post public/),
  ).toBeVisible();
  await student.page.screenshot({ path: resolve(screenshots, "student-bell.png") });

  await student.context.close();
  await classmate.context.close();
  await ta.context.close();
});
