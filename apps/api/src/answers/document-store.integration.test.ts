import { Pool } from "pg";
import request from "supertest";
import * as Y from "yjs";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { createApp } from "../http/app.js";
import type { AuthService } from "../auth/service.js";
import { AnswerDocumentStore } from "./document-store.js";
import { AnswerService, answerEtag } from "./service.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `answer_documents_${process.pid}_${Date.now()}`;
const ids = {
  organization: "01a0e5cc-58ae-7009-9f43-d1ba75831e01",
  user: "01a0e5cc-58ae-7009-9f43-c8155fb23e05",
  course: "01a0e5cc-58ae-7009-9f43-d5453c12be02",
};
let admin: Pool;
let pool: Pool;
let store: AnswerDocumentStore;
let answerCounter = 0;

async function answer(text = "Original answer") {
  answerCounter += 1;
  const id = `01a0e5cc-58ae-7009-9f43-${answerCounter.toString(16).padStart(12, "0")}`;
  const postId = uuidv7();
  await pool.query(
    "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Question','Body')",
    [postId, ids.course, ids.user],
  );
  await pool.query(
    "INSERT INTO answers (id,course_id,post_id,kind,body_markdown) VALUES ($1,$2,$3,'student',$4)",
    [id, ids.course, postId, text],
  );
  await pool.query(
    "INSERT INTO answer_collaboration_documents (answer_id,yjs_state) VALUES ($1,$2)",
    [id, Buffer.from([0, 0])],
  );
  return id;
}

integration("answer Yjs document persistence", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.organization],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'user@example.edu','User','x')",
      [ids.user, ids.organization],
    );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Course','ABCDEFGH')",
      [ids.course, ids.organization, ids.user],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
      [ids.course, ids.user],
    );
    store = new AnswerDocumentStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("seeds the legacy empty marker once and loads the durable Yjs text", async () => {
    const id = await answer("Original answer");
    const first = await store.load(id);
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, first.state);
    expect(decoded.getText("content").toString()).toBe("Original answer");
    expect(first).toMatchObject({
      text: "Original answer",
      answerVersion: 1,
      persistenceRevision: 1,
    });
    const again = await new AnswerDocumentStore(pool).load(id);
    expect(again).toEqual(first);
  });

  it("merges independent updates durably and advances both revisions when text changes", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const first = new Y.Doc();
    const second = new Y.Doc();
    Y.applyUpdate(first, initial.state);
    Y.applyUpdate(second, initial.state);
    first.getText("content").insert(4, " A");
    second.getText("content").insert(4, " B");
    const [left, right] = await Promise.all([
      store.applyUpdate(id, Y.encodeStateAsUpdate(first)),
      store.applyUpdate(id, Y.encodeStateAsUpdate(second)),
    ]);
    const latest = await new AnswerDocumentStore(pool).load(id);
    expect(latest.text).toContain(" A");
    expect(latest.text).toContain(" B");
    expect(latest.text).toHaveLength(8);
    expect(latest).toMatchObject({ answerVersion: 3, persistenceRevision: 3 });
    const row = await pool.query(
      "SELECT body_markdown,version FROM answers WHERE id=$1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      body_markdown: latest.text,
      version: "3",
    });
    expect([left.answerVersion, right.answerVersion].sort()).toEqual([2, 3]);
  });

  it("does not advance revisions or timestamps on duplicate replay", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").insert(4, " more");
    const update = Y.encodeStateAsUpdate(editor);
    const once = await store.applyUpdate(id, update);
    const before = await pool.query(
      "SELECT a.updated_at,d.persisted_at FROM answers a JOIN answer_collaboration_documents d ON d.answer_id=a.id WHERE a.id=$1",
      [id],
    );
    const twice = await store.applyUpdate(id, update);
    const after = await pool.query(
      "SELECT a.updated_at,d.persisted_at FROM answers a JOIN answer_collaboration_documents d ON d.answer_id=a.id WHERE a.id=$1",
      [id],
    );
    expect(twice).toEqual(once);
    expect(after.rows).toEqual(before.rows);
  });

  it("advances only the persistence revision for a state-only update", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getMap("metadata").set("key", "value");
    const saved = await store.applyUpdate(id, Y.encodeStateAsUpdate(editor));
    expect(saved).toMatchObject({
      text: "Base",
      answerVersion: 1,
      persistenceRevision: 2,
    });
    expect(
      (await pool.query("SELECT version FROM answers WHERE id=$1", [id]))
        .rows[0].version,
    ).toBe("1");
  });

  it("rejects invalid updates and content without changing persisted state", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    await expect(store.applyUpdate(id, new Uint8Array())).rejects.toMatchObject(
      { code: "invalid_update" },
    );
    await expect(
      store.applyUpdate(id, Uint8Array.from([255])),
    ).rejects.toMatchObject({ code: "invalid_update" });
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").delete(0, 4);
    editor.getText("content").insert(0, "   ");
    await expect(
      store.applyUpdate(id, Y.encodeStateAsUpdate(editor)),
    ).rejects.toMatchObject({ code: "invalid_content" });
    expect(await store.load(id)).toEqual(initial);
  });

  it("rejects inactive lifecycle and a projection mismatch", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").insert(4, " edit");
    const update = Y.encodeStateAsUpdate(editor);
    await pool.query(
      "UPDATE answers SET body_markdown='mismatch' WHERE id=$1",
      [id],
    );
    await expect(store.load(id)).rejects.toMatchObject({
      code: "integrity_error",
    });
    await pool.query("UPDATE answers SET body_markdown='Base' WHERE id=$1", [
      id,
    ]);
    await pool.query(
      "UPDATE answer_collaboration_documents SET lifecycle_state='finalizing' WHERE answer_id=$1",
      [id],
    );
    await expect(store.load(id)).rejects.toMatchObject({
      code: "not_available",
    });
    await expect(store.applyUpdate(id, update)).rejects.toMatchObject({
      code: "not_available",
    });
    await pool.query(
      "UPDATE answer_collaboration_documents SET lifecycle_state='active' WHERE answer_id=$1",
      [id],
    );
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    await expect(store.load(id)).rejects.toMatchObject({
      code: "not_available",
    });
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
  });

  it("rejects documents when their question is deleted or merged", async () => {
    const targetId = await answer("Target");
    const targetPostId = (
      await pool.query("SELECT post_id FROM answers WHERE id=$1", [targetId])
    ).rows[0].post_id;
    for (const state of ["deleted", "confirmed"] as const) {
      const id = await answer("Base");
      const initial = await store.load(id);
      const editor = new Y.Doc();
      Y.applyUpdate(editor, initial.state);
      editor.getText("content").insert(4, " edit");
      const update = Y.encodeStateAsUpdate(editor);
      const postId = (
        await pool.query("SELECT post_id FROM answers WHERE id=$1", [id])
      ).rows[0].post_id;
      if (state === "deleted") {
        await pool.query(
          "UPDATE posts SET title=NULL,body_markdown=NULL,author_user_id=NULL,deleted_at=now() WHERE id=$1",
          [postId],
        );
      } else {
        await pool.query(
          "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
          [postId, targetPostId],
        );
      }
      await expect(store.load(id)).rejects.toMatchObject({
        code: "not_available",
      });
      await expect(store.applyUpdate(id, update)).rejects.toMatchObject({
        code: "not_available",
      });
      const persisted = await pool.query(
        "SELECT a.body_markdown,a.version,d.yjs_state,d.persistence_revision FROM answers a JOIN answer_collaboration_documents d ON d.answer_id=a.id WHERE a.id=$1",
        [id],
      );
      expect(persisted.rows[0]).toMatchObject({
        body_markdown: initial.text,
        version: String(initial.answerVersion),
        yjs_state: Buffer.from(initial.state),
        persistence_revision: String(initial.persistenceRevision),
      });
    }
  });

  it("orders endorsement and deletion after durable updates and blocks later writes", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").insert(4, " edit");
    const updated = await store.applyUpdate(id, Y.encodeStateAsUpdate(editor));
    const answers = new AnswerService(pool);
    const before = await answers.get(id, ids.user);
    expect(before.bodyMarkdown).toBe("Base edit");
    expect(answerEtag(before)).toBe('"v2"');
    await answers.endorse(id, ids.user, answerEtag(before));
    await expect(store.load(id)).rejects.toMatchObject({
      code: "not_available",
    });
    await expect(store.applyUpdate(id, updated.state)).rejects.toMatchObject({
      code: "not_available",
    });
    const deletedId = await answer("Another");
    const deletionVersion = await answers.get(deletedId, ids.user);
    await answers.delete(deletedId, ids.user, answerEtag(deletionVersion));
    await expect(store.load(deletedId)).rejects.toMatchObject({
      code: "not_available",
    });
  });

  it("projects a saved edit through the answer GET body and ETag", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").insert(4, " edit");
    await store.applyUpdate(id, Y.encodeStateAsUpdate(editor));
    const app = createApp({
      answerService: new AnswerService(pool),
      authService: {
        session: async () => ({
          id: ids.user,
          user: {
            id: ids.user,
            email: "user@example.edu",
            displayName: "User",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            version: 1,
          },
          expiresAt: "2026-12-01T00:00:00.000Z",
          csrfToken: "csrf",
        }),
      } as AuthService,
    });
    const result = await request(app)
      .get(`/api/v1/answers/${id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(result.status).toBe(200);
    expect(result.headers.etag).toBe('"v2"');
    expect(result.body.data).toMatchObject({
      bodyMarkdown: "Base edit",
      version: 2,
    });
  });

  it("rejects oversized binary and projected text", async () => {
    const id = await answer("Base");
    const initial = await store.load(id);
    await expect(
      store.applyUpdate(id, new Uint8Array(1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "invalid_update" });
    const editor = new Y.Doc();
    Y.applyUpdate(editor, initial.state);
    editor.getText("content").insert(4, "x".repeat(100_000));
    await expect(
      store.applyUpdate(id, Y.encodeStateAsUpdate(editor)),
    ).rejects.toMatchObject({ code: "invalid_content" });
    expect(await store.load(id)).toEqual(initial);
  });
});
