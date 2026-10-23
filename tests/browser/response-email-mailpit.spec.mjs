// Full-stack SMTP smoke test. Run only against a new disposable PostgreSQL DB,
// the real API/worker/web, and an isolated Mailpit instance.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(
  !databaseUrl || !process.env.E2E_MAILPIT_URL,
  "Set E2E_DATABASE_URL and E2E_MAILPIT_URL for an isolated stack",
);
const mailpit = process.env.E2E_MAILPIT_URL;
const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(
    import.meta.dirname,
    "../../docs/pr-screenshots/response-email-links",
  );
mkdirSync(screenshots, { recursive: true });

async function deliveredEmail(request, address, subject) {
  let message;
  await expect
    .poll(
      async () => {
        const search = await request.get(
          `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${address}" subject:"${subject}"`)}`,
        );
        const [found] = (await search.json()).messages ?? [];
        if (!found) return false;
        const full = await request.get(`${mailpit}/api/v1/message/${found.ID}`);
        message = await full.json();
        return Boolean(message.Text);
      },
      { timeout: 40_000 },
    )
    .toBe(true);
  return message;
}

function responseUrl(text, kind) {
  const match = text.match(
    new RegExp(`https:\\/\\/[^\\s]+#${kind}-[0-9a-f-]{36}`, "i"),
  );
  expect(match, `missing ${kind} link in delivered MIME text`).not.toBeNull();
  return match[0];
}

test("actual Mailpit emails preview answer, followup, and nested reply and open their exact links", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  const title = "Which response email should I open?";

  await student.page.goto(`${BASE}/courses/${courseId}/settings`);
  await student.page
    .getByRole("checkbox", { name: "Activity emails on followed posts" })
    .click();
  await expect(student.page.getByText("Email preference saved")).toBeVisible();
  await student.page.goto(`${BASE}/courses/${courseId}`);
  await student.page.getByRole("button", { name: "Create post" }).click();
  await student.page.getByRole("textbox", { name: "Post title" }).fill(title);
  await student.page
    .getByRole("textbox", { name: "Post body" })
    .fill("Please answer and discuss.");
  await student.page.getByRole("button", { name: "Publish post" }).click();
  await expect(
    student.page.getByRole("heading", { name: title }),
  ).toBeVisible();
  const postUrl = student.page.url();

  await ta.page.goto(postUrl);
  await ta.page
    .getByRole("button", { name: "Start instructors' answer" })
    .click();
  await ta.page
    .getByRole("textbox", { name: "Your answer" })
    .fill(
      "Answer first line.\nAnswer second line.\nAnswer third line.\nHidden fourth line.",
    );
  await ta.page.getByRole("button", { name: "Post answer" }).click();
  await expect(ta.page.getByText("Answer first line.")).toBeVisible();
  const answerMail = await deliveredEmail(
    student.page.request,
    people.student.email,
    "New answer on",
  );
  expect(answerMail.Subject).toContain("New answer on");
  expect(answerMail.Text.replaceAll("\r\n", "\n")).toContain(
    "Answer first line.\nAnswer second line.\nAnswer third line.",
  );
  expect(answerMail.Text).not.toContain("Hidden fourth line.");
  const answerLink = responseUrl(answerMail.Text, "answer");
  await student.page.goto(answerLink);
  await expect(
    student.page.locator(`#${new URL(answerLink).hash.slice(1)}`),
  ).toBeFocused();
  await student.page.screenshot({
    path: resolve(screenshots, "live-mailpit-answer-link.png"),
    fullPage: true,
  });

  await ta.page
    .getByRole("button", { name: "Compose a new followup discussion" })
    .click();
  await ta.page
    .getByRole("textbox", { name: "Followup" })
    .fill("A separate followup line.");
  await ta.page.getByRole("button", { name: "Post followup" }).click();
  const rootMail = await deliveredEmail(
    student.page.request,
    people.student.email,
    "New followup on",
  );
  expect(rootMail.Text).toContain("A separate followup line.");
  const rootLink = responseUrl(rootMail.Text, "followup");
  await student.page.goto(rootLink);
  await expect(
    student.page.locator(`#${new URL(rootLink).hash.slice(1)}`),
  ).toBeFocused();
  await student.page.screenshot({
    path: resolve(screenshots, "live-mailpit-root-link.png"),
    fullPage: true,
  });

  const root = ta.page
    .getByRole("article", { name: new RegExp(`Followup by ${people.ta.name}`) })
    .first();
  await root.getByRole("button", { name: "Reply", exact: true }).click();
  await root
    .getByRole("textbox", { name: "Followup" })
    .fill("The nested reply text.");
  await root.getByRole("button", { name: "Post reply" }).click();
  const replyMail = await deliveredEmail(
    student.page.request,
    people.student.email,
    "New reply on",
  );
  expect(replyMail.Text).toContain("The nested reply text.");
  const replyLink = responseUrl(replyMail.Text, "followup");
  await student.page.goto(replyLink);
  const reply = student.page.locator(`#${new URL(replyLink).hash.slice(1)}`);
  await expect(reply).toBeVisible();
  await expect(reply).toBeFocused();
  await expect(reply).toContainText("The nested reply text.");
  await student.page.screenshot({
    path: resolve(screenshots, "live-mailpit-reply-link.png"),
    fullPage: true,
  });

  await student.context.close();
  await ta.context.close();
});
