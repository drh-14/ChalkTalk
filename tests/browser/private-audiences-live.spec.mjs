// Full-stack privacy regression against an isolated running API and database.
// Set E2E_BASE_URL and E2E_DATABASE_URL; unlike post-audiences.spec.mjs,
// no application request is mocked.
import { mkdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import process from "node:process";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { expect, test } from "@playwright/test";
import { BASE, databaseUrl, seed, signIn } from "./fixtures/live-stack.mjs";

test.use({ ignoreHTTPSErrors: true });
test.skip(
  !process.env.E2E_DATABASE_URL || !process.env.E2E_BASE_URL,
  "Requires an explicitly configured isolated database and running API",
);

const screenshots =
  process.env.TEST_EVIDENCE_DIR ??
  resolve(import.meta.dirname, "../../docs/pr-screenshots/post-audiences-live");
mkdirSync(screenshots, { recursive: true });

test("revocation rejects a live group draft and hides attachments and sessions", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { courseId, people } = await seed();
  const groupId = uuidv7();
  const postId = uuidv7();
  const attachmentId = uuidv7();
  const sessionId = uuidv7();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      "INSERT INTO private_post_groups(id,course_id,name) VALUES ($1,$2,'Lab mentors')",
      [groupId, courseId],
    );
    await pool.query(
      "INSERT INTO private_post_group_members(group_id,course_id,user_id) VALUES ($1,$2,$3)",
      [groupId, courseId, people.student.id],
    );
    await pool.query(
      "INSERT INTO posts(id,course_id,author_user_id,type,title,body_markdown,audience,audience_group_id) VALUES ($1,$2,$3,'question','Restricted lab post','Restricted body','group',$4)",
      [postId, courseId, people.ta.id, groupId],
    );
    await pool.query(
      "INSERT INTO content_attachments(id,course_id,post_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,'private.txt','text/plain',1,$5)",
      [
        attachmentId,
        courseId,
        postId,
        `private-test/${attachmentId}`,
        Buffer.alloc(32),
      ],
    );
    await pool.query(
      "INSERT INTO collaboration_sessions(id,course_id,post_id,title,created_by_user_id) VALUES ($1,$2,$3,'Restricted live session',$4)",
      [sessionId, courseId, postId, people.ta.id],
    );
    await pool.query(
      "INSERT INTO collaboration_documents(collaboration_session_id,yjs_state,text_projection) VALUES ($1,$2,'Restricted code')",
      [sessionId, Buffer.from([0, 0])],
    );

    const student = await signIn(browser, people.student);
    const outsider = await signIn(browser, people.classmate);
    try {
      await student.page.goto(`${BASE}/courses/${courseId}`);
      await student.page.getByRole("button", { name: "Create post" }).click();
      await student.page
        .getByRole("combobox", { name: "Post to" })
        .selectOption("group");
      await student.page
        .getByRole("combobox", { name: "Private group" })
        .selectOption(groupId);
      await student.page
        .getByRole("textbox", { name: "Post title" })
        .fill("Keep my draft");
      await student.page
        .getByRole("textbox", { name: "Post body" })
        .fill("The body remains after revocation.");
      await student.page.screenshot({
        path: resolve(screenshots, "before-group-revocation.png"),
        fullPage: true,
      });

      // Revocation commits while the real browser still holds its draft.
      await pool.query(
        "DELETE FROM private_post_group_members WHERE group_id=$1 AND user_id=$2",
        [groupId, people.student.id],
      );
      const submitted = student.page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/courses/${courseId}/posts`) &&
          response.request().method() === "POST",
      );
      await student.page.getByRole("button", { name: "Publish post" }).click();
      expect((await submitted).status()).toBeGreaterThanOrEqual(400);
      await expect(student.page.getByRole("alert")).toBeVisible();
      await expect(
        student.page.getByRole("textbox", { name: "Post title" }),
      ).toHaveValue("Keep my draft");
      await expect(
        student.page.getByRole("textbox", { name: "Post body" }),
      ).toContainText("The body remains after revocation.");
      await student.page.screenshot({
        path: resolve(screenshots, "rejected-group-draft.png"),
        fullPage: true,
      });

      for (const page of [student.page, outsider.page]) {
        for (const path of [
          `/api/v1/posts/${postId}`,
          `/api/v1/attachments/${attachmentId}/download`,
          `/api/v1/collaboration-sessions/${sessionId}`,
          `/api/v1/collaboration-sessions/${sessionId}/snapshot`,
        ]) {
          const response = await page.request.get(`${BASE}${path}`);
          expect(response.status(), path).toBe(404);
        }
      }
      await outsider.page.goto(`${BASE}/courses/${courseId}/posts/${postId}`);
      await expect(outsider.page.getByRole("alert")).toContainText(
        "This post is unavailable.",
      );
      await expect(outsider.page.getByText("Restricted lab post")).toHaveCount(
        0,
      );
      await outsider.page.screenshot({
        path: resolve(screenshots, "restricted-post-after-revocation.png"),
        fullPage: true,
      });
      await student.page.goto(
        `${BASE}/courses/${courseId}/sessions/${sessionId}`,
      );
      await expect(
        student.page.getByRole("heading", {
          name: "This session isn't available",
        }),
      ).toBeVisible();
      await expect(
        student.page.getByText("Restricted live session"),
      ).toHaveCount(0);
      await student.page.screenshot({
        path: resolve(screenshots, "restricted-session-after-revocation.png"),
        fullPage: true,
      });
    } finally {
      await student.context.close();
      await outsider.context.close();
    }
  } finally {
    await pool.end();
  }
});
