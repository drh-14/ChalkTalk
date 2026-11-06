// End-to-end live session viewer and posting against the running development
// stack (`npm run dev`). It seeds its own course and accounts directly in the
// database named by E2E_DATABASE_URL (or DATABASE_URL) and is skipped without one.
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

const screenshots = process.env.E2E_SCREENSHOTS_DIR
  ? resolve(process.env.E2E_SCREENSHOTS_DIR, "session-viewers")
  : resolve(
      import.meta.dirname,
      "../../test-results/browser-screenshots/session-viewers",
    );
mkdirSync(screenshots, { recursive: true });

const editorText = (page) =>
  page.locator(".cm-content").evaluate((element) =>
    [...element.querySelectorAll(".cm-line")]
      .map((line) => {
        const copy = line.cloneNode(true);
        for (const widget of copy.querySelectorAll(".cm-ySelectionCaret"))
          widget.remove();
        return copy.textContent;
      })
      .join("\n"),
  );

test("a viewer follows along without editing and cannot post to discussion", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const viewer = await signIn(browser, people.classmate);

  await student.page.goto(`${BASE}/courses/${courseId}/collaboration`);
  await student.page
    .getByRole("button", { name: "Start live session" })
    .click();
  await student.page.getByLabel("Title").fill("Viewer walkthrough");
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page
    .getByLabel("Invite a course member")
    .selectOption({ label: `${people.classmate.name} (student)` });
  await student.page.getByRole("radio", { name: "Can view" }).click();
  await student.page
    .getByRole("button", { name: "Invite", exact: true })
    .click();
  await expect(
    student.page.locator(".session-participants li", {
      hasText: people.classmate.name,
    }),
  ).toContainText("Invited · Viewer");

  // The viewer joins read-only and follows the student's typing.
  await viewer.page.goto(sessionUrl);
  await expect(viewer.page.locator(".session-state")).toHaveText("Connected");
  await expect(viewer.page.getByText("View only")).toBeVisible();
  await expect(viewer.page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    viewer.page.getByRole("button", { name: "Post to discussion" }),
  ).toHaveCount(0);
  await student.page.locator(".cm-content").click();
  await student.page.keyboard.type("while True:\n    break");
  await expect
    .poll(() => editorText(viewer.page))
    .toBe("while True:\n    break");
  await viewer.page.locator(".cm-content").click();
  await viewer.page.keyboard.type("oops");
  await expect
    .poll(() => editorText(student.page))
    .toBe("while True:\n    break");
  await viewer.page.screenshot({
    path: resolve(screenshots, "viewer-read-only.png"),
  });

  await student.context.close();
  await viewer.context.close();
});

test("an uninvited TA cannot discover a session; a View-invited TA remains read-only", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const { courseId, people } = await seed();
  const student = await signIn(browser, people.student);
  const ta = await signIn(browser, people.ta);
  await student.page.goto(`${BASE}/courses/${courseId}/collaboration`);
  await student.page
    .getByRole("button", { name: "Start live session" })
    .click();
  await student.page.getByLabel("Title").fill("Private pairing");
  await student.page.getByRole("button", { name: "Start session" }).click();
  await student.page.waitForURL(/\/sessions\//);
  const sessionUrl = student.page.url();
  const sessionId = sessionUrl.split("/sessions/")[1];

  // Staff role alone cannot list, inspect, or obtain a live editor ticket.
  const list = await ta.page.request.get(
    `${BASE}/api/v1/courses/${courseId}/collaboration-sessions`,
  );
  expect(list.status()).toBe(200);
  expect(
    (await list.json()).data.some((session) => session.id === sessionId),
  ).toBe(false);
  expect(
    (
      await ta.page.request.get(
        `${BASE}/api/v1/collaboration-sessions/${sessionId}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await ta.page.request.post(
        `${BASE}/api/v1/collaboration-sessions/${sessionId}/connection-tickets`,
        {
          headers: {
            Origin: BASE,
            "X-CSRF-Token": (
              await ta.page.request
                .get(`${BASE}/api/v1/sessions/current`)
                .then((r) => r.json())
            ).data.csrfToken,
          },
        },
      )
    ).status(),
  ).toBe(404);
  await ta.page.goto(sessionUrl);
  await expect(
    ta.page.getByRole("heading", { name: "This session isn't available" }),
  ).toBeVisible();

  await student.page.getByRole("button", { name: "+ Invite" }).click();
  await student.page
    .getByLabel("Invite a course member")
    .selectOption({ label: `${people.ta.name} (TA)` });
  await student.page.getByRole("radio", { name: "Can view" }).click();
  await student.page
    .getByRole("button", { name: "Invite", exact: true })
    .click();
  await ta.page.reload();
  await expect(ta.page.locator(".session-state")).toHaveText("Connected");
  await expect(ta.page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(ta.page.getByText("View only")).toBeVisible();
  await ta.page.screenshot({
    path: resolve(screenshots, "staff-view-only.png"),
  });
  await student.context.close();
  await ta.context.close();
});
