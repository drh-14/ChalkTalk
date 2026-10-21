// End-to-end live session invitation against the running development stack
// (`npm run dev`, with the job worker and Mailpit). It seeds its own course and
// accounts directly in the database named by E2E_DATABASE_URL (or DATABASE_URL)
// and is skipped without one.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";
const screenshots = resolve(import.meta.dirname, "../../docs/pr-screenshots/session-invitations");
mkdirSync(screenshots, { recursive: true });

/** The text of the newest email to `address`, once the worker has sent it. */
async function emailTo(request, address) {
  let text;
  await expect
    .poll(
      async () => {
        const search = await request.get(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
        );
        const [message] = (await search.json()).messages ?? [];
        if (!message) return undefined;
        const full = await request.get(`${MAILPIT}/api/v1/message/${message.ID}`);
        const body = await full.json();
        text = { subject: body.Subject, text: body.Text };
        return body.Subject;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
  return text;
}

test("an invited TA is emailed and joins from the home page", async ({ browser }) => {
  test.setTimeout(120_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);

  await student.page.goto(`${BASE}/courses/${courseId}/posts/${postId}`);
  await student.page.getByRole("button", { name: "Start live session" }).click();
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionPath = new URL(student.page.url()).pathname;
  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page.getByLabel("Invite a course member").selectOption({ label: `${people.ta.name} (TA)` });
  await student.page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(student.page.locator(".session-participants").getByText(people.ta.name)).toBeVisible();

  // The worker emails the TA a link to the session.
  const email = await emailTo(ta.page.request, people.ta.email);
  expect(email.subject).toBe(`${people.student.name} invited you to a live session`);
  expect(email.text).toContain(`invited you to the live session "My loop never stops"`);
  expect(email.text).toContain(`${sessionPath}`);

  // The TA finds it on the home page and joins.
  await ta.page.goto(BASE);
  const list = ta.page.locator(".live-sessions-card");
  await expect(list.getByRole("heading", { name: "Your live sessions" })).toBeVisible();
  await expect(list).toContainText("You were invited");
  await ta.page.screenshot({ path: resolve(screenshots, "home-your-live-sessions.png") });
  await list.getByRole("button", { name: "Join My loop never stops" }).click();
  await ta.page.waitForURL((url) => url.pathname === sessionPath);
  await expect(ta.page.locator(".session-state")).toHaveText("Connected");

  // Staff see the course's running sessions on the discussion page.
  await ta.page.goto(`${BASE}/courses/${courseId}`);
  const running = ta.page.locator(".course-live-sessions");
  await expect(running).toContainText("1 running in this course");
  await expect(running).toContainText(people.student.name);
  await ta.page.screenshot({ path: resolve(screenshots, "course-live-sessions-staff.png") });

  await student.context.close();
  await ta.context.close();
});
