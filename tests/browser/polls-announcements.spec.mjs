// End-to-end polls and announcements against the running development stack
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
  "../../docs/pr-screenshots/polls-announcements",
);
mkdirSync(screenshots, { recursive: true });

async function compose(page, courseId, { type, title, body }) {
  await page.goto(`${BASE}/courses/${courseId}`);
  await page.getByRole("button", { name: "Create post" }).click();
  await page.getByRole("combobox", { name: "Post type" }).selectOption(type);
  await page.getByRole("textbox", { name: "Post title" }).fill(title);
  await page.getByRole("textbox", { name: "Post body" }).click();
  await page.keyboard.type(body);
}

test("a TA runs a poll, a student votes, and a TA announcement is pinned and emailed", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { courseId, people } = await seed();
  const ta = await signIn(browser, people.ta);
  const student = await signIn(browser, people.student);

  // The TA creates a poll.
  await compose(ta.page, courseId, {
    type: "poll",
    title: "Which review session time works?",
    body: "Pick the slot you can make.",
  });
  await ta.page.getByRole("textbox", { name: "Option 1" }).fill("Monday 5pm");
  await ta.page
    .getByRole("textbox", { name: "Option 2" })
    .fill("Wednesday 6pm");
  await ta.page.getByRole("button", { name: "+ Add option" }).click();
  await ta.page.getByRole("textbox", { name: "Option 3" }).fill("Friday noon");
  await ta.page.screenshot({ path: resolve(screenshots, "compose-poll.png") });
  await ta.page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    ta.page.getByRole("heading", { name: "Poll · 0 votes" }),
  ).toBeVisible();

  // The student votes, sees the results, and changes their vote.
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await student.page
    .getByText("Which review session time works?")
    .first()
    .click();
  const poll = student.page.locator(".poll-card");
  await poll.getByRole("radio", { name: "Wednesday 6pm" }).check();
  await poll.getByRole("button", { name: "Vote" }).click();
  await expect(poll.getByRole("heading")).toHaveText("Poll · 1 vote");
  await expect(poll.locator("li.selected")).toContainText(
    "Wednesday 6pm · your vote",
  );
  await poll.getByRole("button", { name: "Change vote" }).click();
  await poll.getByRole("radio", { name: "Friday noon" }).check();
  await poll.getByRole("button", { name: "Vote" }).click();
  await expect(poll.locator("li.selected")).toContainText(
    "Friday noon · your vote",
  );
  await expect(poll.getByRole("heading")).toHaveText("Poll · 1 vote");
  await student.page.screenshot({
    path: resolve(screenshots, "poll-results.png"),
  });

  // The TA posts an announcement; it is pinned with a badge and emailed.
  await compose(ta.page, courseId, {
    type: "note",
    title: "Office hours moved to Thursday",
    body: "Same room, 3 to 5pm.",
  });
  await ta.page
    .getByRole("checkbox", {
      name: "Post as announcement (pinned; email sent to subscribers)",
    })
    .check();
  await ta.page.getByRole("button", { name: "Publish post" }).click();
  await student.page.goto(`${BASE}/courses/${courseId}`);
  const first = student.page.locator(".post-card").first();
  await expect(first).toContainText("Office hours moved to Thursday");
  await expect(first).toContainText("Announcement");
  await student.page.screenshot({
    path: resolve(screenshots, "announcement-pinned.png"),
  });

  await expect
    .poll(
      async () => {
        const search = await student.page.request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${people.student.email}" subject:"Office hours moved"`)}`,
        );
        return (await search.json()).messages?.length ?? 0;
      },
      { timeout: 60_000 },
    )
    .toBe(1);

  await student.context.close();
  await ta.context.close();
});
