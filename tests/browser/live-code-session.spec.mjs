// End-to-end live code session against the running development stack
// (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
import { randomUUID } from "node:crypto";
import process from "node:process";
import argon2 from "argon2";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://localhost:5173";
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
const PASSWORD = "live session e2e password";

test.use({ ignoreHTTPSErrors: true });
test.skip(!databaseUrl, "Set E2E_DATABASE_URL or DATABASE_URL to the running stack's database");

async function seed() {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const suffix = randomUUID().slice(0, 8);
  const domain = `e2e-${suffix}.example.edu`;
  const organizationId = uuidv7();
  const courseId = uuidv7();
  const postId = uuidv7();
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const people = {
    student: { id: uuidv7(), name: `Sam Student ${suffix}`, role: "student" },
    ta: { id: uuidv7(), name: `Tara TA ${suffix}`, role: "ta" },
  };
  try {
    await pool.query("INSERT INTO organizations (id,domain,name) VALUES ($1,$2,'E2E University')", [
      organizationId,
      domain,
    ]);
    for (const [key, person] of Object.entries(people)) {
      person.email = `${key}@${domain}`;
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [person.id, organizationId, person.email, person.name, passwordHash],
      );
    }
    await pool.query(
      "INSERT INTO courses (id,organization_id,name,created_by_user_id,join_code) VALUES ($1,$2,$3,$4,$5)",
      [courseId, organizationId, `E2E ${suffix}`, people.ta.id, suffix.toUpperCase()],
    );
    for (const person of Object.values(people))
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,$3)",
        [courseId, person.id, person.role],
      );
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','My loop never stops','Help with my while loop.')",
      [postId, courseId, people.student.id],
    );
  } finally {
    await pool.end();
  }
  return { courseId, postId, people };
}

async function signIn(browser, person) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(BASE);
  const response = await page.request.post(`${BASE}/api/v1/sessions`, {
    headers: { Origin: BASE, "Content-Type": "application/json" },
    data: { email: person.email, password: PASSWORD },
  });
  expect(response.status()).toBe(201);
  return { context, page };
}

// Line text without remote cursor widgets, which render inside the lines.
const editorText = (page) =>
  page.locator(".cm-content").evaluate((element) =>
    [...element.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true);
        for (const widget of copy.querySelectorAll(".cm-ySelectionCaret")) widget.remove();
        return copy.textContent;
      })
      .join("\n"),
  );

test("a student and a TA edit, see each other, and end a live code session", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { courseId, postId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);

  // The student starts a Python session from their question and invites the TA.
  await student.page.goto(`${BASE}/courses/${courseId}/posts/${postId}`);
  await student.page.getByRole("button", { name: "Start live code session" }).click();
  await student.page.getByLabel("Language").selectOption("python");
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  await expect(student.page.getByRole("status")).toHaveText("Connected");
  await student.page.getByLabel("Invite a course member").selectOption({ label: `${people.ta.name} (TA)` });
  await student.page.getByRole("button", { name: "Invite" }).click();
  await expect(
    student.page.locator(".session-participants").getByText(people.ta.name),
  ).toBeVisible();

  // The TA opens the same session.
  await ta.page.goto(sessionUrl);
  await expect(ta.page.getByRole("status")).toHaveText("Connected");

  // Both type at once; both editors converge on text containing both edits.
  await student.page.locator(".cm-content").click();
  await ta.page.locator(".cm-content").click();
  await Promise.all([
    student.page.keyboard.type("while True:\n"),
    ta.page.keyboard.type("# TA: add a break\n"),
  ]);
  await expect
    .poll(async () => {
      const [mine, theirs] = await Promise.all([editorText(student.page), editorText(ta.page)]);
      return mine === theirs && mine.includes("while True:") && mine.includes("# TA: add a break");
    })
    .toBe(true);

  // Each sees the other's cursor labelled with their real name.
  await student.page.keyboard.type("x");
  await ta.page.keyboard.type("y");
  await expect(ta.page.locator(".cm-ySelectionInfo", { hasText: people.student.name })).toHaveCount(1);
  await expect(student.page.locator(".cm-ySelectionInfo", { hasText: people.ta.name })).toHaveCount(1);
  const finalText = await editorText(ta.page);

  // The TA ends the session; both editors become read-only with the final text.
  ta.page.once("dialog", (dialog) => void dialog.accept());
  await ta.page.getByRole("button", { name: "End session" }).click();
  for (const { page } of [ta, student]) {
    await expect(page.getByRole("status")).toHaveText("Session ended (read-only)");
    await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
    await expect.poll(() => editorText(page)).toBe(finalText);
  }

  await student.context.close();
  await ta.context.close();
});
