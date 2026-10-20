import type { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestSchema, seedCourse } from "./test-fixtures.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration("collaboration session schema", () => {
  let database: Awaited<ReturnType<typeof createTestSchema>>;
  let pool: Pool;
  let fixture: Awaited<ReturnType<typeof seedCourse>>;

  beforeAll(async () => {
    database = await createTestSchema(url!, "collab_schema");
    pool = database.pool;
    fixture = await seedCourse(pool, { alice: "student", tim: "ta" });
  });
  afterAll(async () => database?.drop());

  async function insertSession(values: { title?: string; language?: string }) {
    const id = uuidv7();
    await pool.query(
      "INSERT INTO collaboration_sessions (id, course_id, post_id, title, language, created_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        id,
        fixture.courseId,
        fixture.postId,
        values.title ?? "Office hours",
        values.language ?? "python",
        fixture.users.alice,
      ],
    );
    return id;
  }

  it("accepts the supported languages and rejects any other", async () => {
    for (const language of [
      "plaintext",
      "python",
      "java",
      "c",
      "cpp",
      "javascript",
      "typescript",
      "sql",
    ])
      await expect(insertSession({ language })).resolves.toBeTruthy();
    await expect(insertSession({ language: "rust" })).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("requires a trimmed title of 1 to 120 characters", async () => {
    await expect(
      insertSession({ title: "x".repeat(120) }),
    ).resolves.toBeTruthy();
    for (const title of ["", "x".repeat(121), " padded "])
      await expect(insertSession({ title })).rejects.toMatchObject({
        code: "23514",
      });
  });

  it("keeps ended_at consistent with the lifecycle state", async () => {
    const id = await insertSession({});
    await expect(
      pool.query(
        "UPDATE collaboration_sessions SET lifecycle_state='ended' WHERE id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "UPDATE collaboration_sessions SET lifecycle_state='ended', ended_at=now() WHERE id=$1",
        [id],
      ),
    ).resolves.toBeTruthy();
  });

  it("keeps one participant row per user and removes it with the membership", async () => {
    const id = await insertSession({});
    const add = () =>
      pool.query(
        "INSERT INTO collaboration_participants (collaboration_session_id, course_id, user_id, invited_by_user_id) VALUES ($1, $2, $3, $4)",
        [id, fixture.courseId, fixture.users.tim, fixture.users.alice],
      );
    await add();
    await expect(add()).rejects.toMatchObject({ code: "23505" });
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [fixture.courseId, fixture.users.tim],
    );
    const remaining = await pool.query(
      "SELECT count(*)::int AS count FROM collaboration_participants WHERE collaboration_session_id=$1",
      [id],
    );
    expect(remaining.rows[0].count).toBe(0);
    await pool.query(
      "INSERT INTO course_memberships (course_id, user_id, role) VALUES ($1, $2, 'ta')",
      [fixture.courseId, fixture.users.tim],
    );
  });

  it("rejects a non-member participant", async () => {
    const id = await insertSession({});
    const outsider = uuidv7();
    await pool.query(
      "INSERT INTO users (id, organization_id, email, display_name, password_hash) VALUES ($1, $2, $3, 'Outsider', 'x')",
      [outsider, fixture.organizationId, `${outsider}@x.example.edu`],
    );
    await expect(
      pool.query(
        "INSERT INTO collaboration_participants (collaboration_session_id, course_id, user_id, invited_by_user_id) VALUES ($1, $2, $3, $4)",
        [id, fixture.courseId, outsider, fixture.users.alice],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("requires unique 32-byte ticket hashes", async () => {
    const id = await insertSession({});
    const authSession = uuidv7();
    await pool.query(
      "INSERT INTO sessions (id, user_id, credential_hash, csrf_token_hash, expires_at) VALUES ($1, $2, $3, $3, now() + interval '1 day')",
      [authSession, fixture.users.alice, Buffer.alloc(32, 7)],
    );
    const ticket = (hash: Buffer) =>
      pool.query(
        "INSERT INTO collaboration_connection_tickets (id, token_hash, collaboration_session_id, course_id, user_id, auth_session_id, permission, expires_at) VALUES ($1, $2, $3, $4, $5, $6, 'write', now() + interval '5 minutes')",
        [
          uuidv7(),
          hash,
          id,
          fixture.courseId,
          fixture.users.alice,
          authSession,
        ],
      );
    await ticket(Buffer.alloc(32, 1));
    await expect(ticket(Buffer.alloc(32, 1))).rejects.toMatchObject({
      code: "23505",
    });
    await expect(ticket(Buffer.alloc(16, 2))).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("defaults the whiteboard projection to an empty array and keeps it an array", async () => {
    const id = await insertSession({});
    await pool.query(
      "INSERT INTO collaboration_documents (collaboration_session_id, yjs_state) VALUES ($1, $2)",
      [id, Buffer.from([0, 0])],
    );
    const saved = await pool.query(
      "SELECT whiteboard_projection FROM collaboration_documents WHERE collaboration_session_id=$1",
      [id],
    );
    expect(saved.rows[0].whiteboard_projection).toEqual([]);
    await expect(
      pool.query(
        "UPDATE collaboration_documents SET whiteboard_projection='{}' WHERE collaboration_session_id=$1",
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("removes sessions and their data when the post or course is removed", async () => {
    const id = await insertSession({});
    await pool.query(
      "INSERT INTO collaboration_documents (collaboration_session_id, yjs_state, text_projection) VALUES ($1, $2, 'print(1)')",
      [id, Buffer.from([0, 0])],
    );
    await pool.query("DELETE FROM collaboration_sessions WHERE post_id=$1", [
      fixture.postId,
    ]);
    const documents = await pool.query(
      "SELECT count(*)::int AS count FROM collaboration_documents WHERE collaboration_session_id=$1",
      [id],
    );
    expect(documents.rows[0].count).toBe(0);
  });
});
