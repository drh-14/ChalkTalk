import { createHash } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { PostService } from "../posts/service.js";
import { createApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `anchors_${process.pid}_${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  author: uuidv7(),
  other: uuidv7(),
  staff: uuidv7(),
  outsider: uuidv7(),
  staffSection: uuidv7(),
};
let admin: Pool;
let pool: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "x@example.edu",
          displayName: "X",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
        expiresAt: "2090-01-01T00:00:00.000Z",
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
  });
}
const cookie = "__Host-chalktalk_session=opaque";
const get = (userId: string, path: string) =>
  request(app(userId)).get(path).set("Cookie", cookie);
const send = (
  userId: string,
  method: "post" | "patch",
  path: string,
  body: object,
  headers: Record<string, string> = {},
) => {
  const agent = request(app(userId));
  return agent[method](path)
    .set("Cookie", cookie)
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf")
    .set(headers)
    .send(body);
};
const createPost = (userId: string, body: object, key?: string) =>
  send(
    userId,
    "post",
    `/api/v1/courses/${ids.course}/posts`,
    body,
    key ? { "Idempotency-Key": key } : {},
  );

/** Adds a file to the course; PDFs by default. */
async function file(mediaType = "application/pdf") {
  const id = uuidv7();
  await pool.query(
    "INSERT INTO course_files (id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,$5,$6,100,$7)",
    [
      id,
      ids.course,
      ids.staff,
      `objects/${id}`,
      "lecture.pdf",
      mediaType,
      createHash("sha256").update(id).digest(),
    ],
  );
  return id;
}
/** Adds a catalog resource with an upload (or a link) as its active revision. */
async function resource(
  options: {
    mediaType?: string;
    link?: boolean;
    visibility?: "class" | "staff";
    sectionId?: string;
  } = {},
) {
  const id = uuidv7();
  const revision = uuidv7();
  const fileId = options.link ? null : await file(options.mediaType);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO course_resources (id,course_id,section_id,title,visibility,position,active_revision_id) VALUES ($1,$2,$3,'Lecture 7',$4,0,$5)",
      [
        id,
        ids.course,
        options.sectionId ?? null,
        options.visibility ?? "class",
        revision,
      ],
    );
    await client.query(
      "INSERT INTO course_resource_revisions (id,resource_id,course_id,kind,file_id,url) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        revision,
        id,
        ids.course,
        options.link ? "link" : "upload",
        fileId,
        options.link ? "https://example.edu/notes" : null,
      ],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return { id, fileId: fileId! };
}
/** Replaces a resource's file the way the catalog does: a new active revision. */
async function replace(resourceId: string) {
  const fileId = await file();
  const revision = uuidv7();
  await pool.query(
    "INSERT INTO course_resource_revisions (id,resource_id,course_id,kind,file_id) VALUES ($1,$2,$3,'upload',$4)",
    [revision, resourceId, ids.course, fileId],
  );
  await pool.query(
    "UPDATE course_resources SET active_revision_id=$2,version=version+1 WHERE id=$1",
    [resourceId, revision],
  );
  return fileId;
}
const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
const anchored = (
  target: { id: string; fileId: string },
  extra: object = {},
) => ({
  type: "question",
  title: "Why left-heavy?",
  bodyMarkdown: "On this slide, why rotate left?",
  anchor: { resourceId: target.id, fileId: target.fileId, page: 14, box },
  ...extra,
});

integration("post anchors", () => {
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
      [ids.org],
    );
    for (const [id, name] of [
      [ids.author, "Author"],
      [ids.other, "Other"],
      [ids.staff, "Staff"],
      [ids.outsider, "Outsider"],
    ])
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name.toLowerCase()}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Data Structures','ABCDEFGH')",
      [ids.course, ids.org, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta')",
      [ids.course, ids.author, ids.other, ids.staff],
    );
    await pool.query(
      "INSERT INTO course_resource_sections (id,course_id,title,visibility,position) VALUES ($1,$2,'Staff notes','staff',0)",
      [ids.staffSection, ids.course],
    );
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  describe("creating", () => {
    it("anchors a question and a note to the current file", async () => {
      const slides = await resource();
      const question = await createPost(ids.author, anchored(slides));
      expect(question.status).toBe(201);
      expect(question.body.data.anchor).toEqual({
        page: 14,
        box,
        status: "current",
        resourceId: slides.id,
        fileId: slides.fileId,
        resourceTitle: "Lecture 7",
      });
      const note = await createPost(
        ids.author,
        anchored(slides, { type: "note", title: "Slide typo" }),
      );
      expect(note.status).toBe(201);
      expect(note.body.data.anchor.status).toBe("current");
      const plain = await createPost(ids.author, {
        type: "question",
        title: "Plain",
        bodyMarkdown: "No slides",
      });
      expect(plain.body.data.anchor).toBeNull();
    });

    it("rejects anchors on polls and announcements", async () => {
      const slides = await resource();
      const poll = await createPost(
        ids.staff,
        anchored(slides, {
          type: "poll",
          options: [{ label: "A" }, { label: "B" }],
        }),
      );
      expect(poll.status).toBe(422);
      expect(poll.body.error.details[0].path).toBe("anchor");
      const announcement = await createPost(
        ids.staff,
        anchored(slides, { type: "note", announcement: true }),
      );
      expect(announcement.status).toBe(422);
      expect(announcement.body.error.details[0].path).toBe("anchor");
    });

    it("names the malformed anchor field", async () => {
      const slides = await resource();
      const cases: [object, string][] = [
        [{ resourceId: slides.id, fileId: slides.fileId, page: 14 }, "anchor"],
        [
          { resourceId: "nope", fileId: slides.fileId, page: 1, box },
          "anchor.resourceId",
        ],
        [
          { resourceId: slides.id, fileId: slides.fileId, page: 0, box },
          "anchor.page",
        ],
        [
          { resourceId: slides.id, fileId: slides.fileId, page: 1.5, box },
          "anchor.page",
        ],
        [
          {
            resourceId: slides.id,
            fileId: slides.fileId,
            page: 1,
            box: { ...box, x: 0.8, width: 0.5 },
          },
          "anchor.box.width",
        ],
        [
          {
            resourceId: slides.id,
            fileId: slides.fileId,
            page: 1,
            box: { ...box, height: 0.005 },
          },
          "anchor.box.height",
        ],
        [
          {
            resourceId: slides.id,
            fileId: slides.fileId,
            page: 1,
            box: { ...box, z: 1 },
          },
          "anchor.box",
        ],
        [
          {
            resourceId: slides.id,
            fileId: slides.fileId,
            page: 1,
            box,
            color: "red",
          },
          "anchor",
        ],
      ];
      for (const [anchor, path] of cases) {
        const response = await createPost(ids.author, {
          ...anchored(slides),
          anchor,
        });
        expect(response.status, path).toBe(422);
        expect(response.body.error.code).toBe("validation_failed");
        expect(response.body.error.details[0]).toMatchObject({
          location: "body",
          path,
        });
      }
    });

    it("rejects resources the author cannot anchor to, all alike", async () => {
      const deleted = await resource();
      await pool.query(
        "UPDATE course_resources SET deleted_at=now() WHERE id=$1",
        [deleted.id],
      );
      const staffOnly = await resource({ sectionId: ids.staffSection });
      const link = await resource({ link: true });
      const docx = await resource({
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const targets = [
        { id: uuidv7(), fileId: uuidv7() },
        deleted,
        staffOnly,
        { id: link.id, fileId: uuidv7() },
        docx,
      ];
      const bodies = [];
      for (const target of targets) {
        const response = await createPost(ids.author, anchored(target));
        expect(response.status).toBe(422);
        bodies.push({
          message: response.body.error.message,
          details: response.body.error.details,
        });
      }
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
      expect(bodies[0]!.details[0].path).toBe("anchor.resourceId");
      // Staff can anchor to the staff-only slides the student could not.
      expect((await createPost(ids.staff, anchored(staffOnly))).status).toBe(
        201,
      );
    });

    it("refuses a file that is no longer current and creates nothing", async () => {
      const slides = await resource();
      await replace(slides.id);
      const before = await pool.query("SELECT count(*)::int AS n FROM posts");
      const response = await createPost(ids.author, anchored(slides));
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("resource_changed");
      const after = await pool.query("SELECT count(*)::int AS n FROM posts");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("treats a changed anchor as a different idempotent request", async () => {
      const slides = await resource();
      const key = uuidv7();
      expect((await createPost(ids.author, anchored(slides), key)).status).toBe(
        201,
      );
      const replay = await createPost(ids.author, anchored(slides), key);
      expect(replay.status).toBe(201);
      const changed = await createPost(
        ids.author,
        {
          ...anchored(slides),
          anchor: { ...anchored(slides).anchor, page: 2 },
        },
        key,
      );
      expect(changed.status).toBe(409);
      expect(changed.body.error.code).toBe("idempotency_key_reused");
    });

    it("never lets an edit change the anchor", async () => {
      const slides = await resource();
      const created = await createPost(ids.author, anchored(slides));
      const path = `/api/v1/posts/${created.body.data.id}`;
      const rejected = await send(
        ids.author,
        "patch",
        path,
        { anchor: { ...anchored(slides).anchor, page: 2 } },
        { "If-Match": created.headers.etag },
      );
      expect(rejected.status).toBe(422);
      const edited = await send(
        ids.author,
        "patch",
        path,
        { title: "Why rotate left?" },
        { "If-Match": created.headers.etag },
      );
      expect(edited.status).toBe(200);
      expect(edited.body.data.anchor).toMatchObject({ page: 14, box });
    });
  });

  it("rejects boxes outside the page or too small in the database", async () => {
    const slides = await resource();
    const created = await createPost(ids.author, {
      type: "question",
      title: "Unanchored",
      bodyMarkdown: "Body",
    });
    const insert = (x: number, width: number) =>
      pool.query(
        "INSERT INTO post_anchors (post_id,course_id,resource_id,file_id,page,box_x,box_y,box_width,box_height) VALUES ($1,$2,$3,$4,1,$5,0,$6,0.5)",
        [created.body.data.id, ids.course, slides.id, slides.fileId, x, width],
      );
    await expect(insert(0.8, 0.5)).rejects.toThrow(/check constraint/);
    await expect(insert(0, 0.005)).rejects.toThrow(/check constraint/);
  });

  describe("reading", () => {
    it("marks earlier versions, and hides unavailable resources' names", async () => {
      const slides = await resource();
      const created = await createPost(ids.author, anchored(slides));
      const path = `/api/v1/posts/${created.body.data.id}`;
      await replace(slides.id);
      expect((await get(ids.other, path)).body.data.anchor).toEqual({
        page: 14,
        box,
        status: "earlier_version",
        resourceId: slides.id,
        fileId: slides.fileId,
        resourceTitle: "Lecture 7",
      });
      await pool.query(
        "UPDATE course_resources SET section_id=$2 WHERE id=$1",
        [slides.id, ids.staffSection],
      );
      expect((await get(ids.other, path)).body.data.anchor).toEqual({
        page: 14,
        box,
        status: "unavailable",
      });
      expect((await get(ids.staff, path)).body.data.anchor.status).toBe(
        "earlier_version",
      );
      await pool.query(
        "UPDATE course_resources SET deleted_at=now() WHERE id=$1",
        [slides.id],
      );
      expect((await get(ids.staff, path)).body.data.anchor).toEqual({
        page: 14,
        box,
        status: "unavailable",
      });
    });

    it("includes anchors in the feed", async () => {
      const slides = await resource();
      const created = await createPost(ids.author, anchored(slides));
      const feed = await get(
        ids.other,
        `/api/v1/courses/${ids.course}/posts?limit=100`,
      );
      expect(feed.status).toBe(200);
      const card = feed.body.data.find(
        (post: { id: string }) => post.id === created.body.data.id,
      );
      expect(card.anchor).toMatchObject({ status: "current", page: 14 });
    });
  });

  describe("listing a resource's questions", () => {
    const questions = (userId: string, resourceId: string) =>
      get(
        userId,
        `/api/v1/courses/${ids.course}/resources/${resourceId}/questions`,
      );

    it("lists readable anchored posts in page order", async () => {
      const slides = await resource();
      const at = (page: number, extra: object = {}) =>
        createPost(ids.author, {
          ...anchored(slides),
          title: `Page ${page}`,
          anchor: { ...anchored(slides).anchor, page },
          ...extra,
        });
      const later = await at(9);
      const first = await at(3);
      const secret = await at(5, { private: true });
      const gone = await at(6);
      await pool.query(
        "UPDATE posts SET deleted_at=now(),title=NULL,body_markdown=NULL,author_user_id=NULL WHERE id=$1",
        [gone.body.data.id],
      );
      const merged = await at(7);
      await pool.query(
        "UPDATE posts SET duplicate_status='confirmed',duplicate_of_post_id=$2 WHERE id=$1",
        [merged.body.data.id, first.body.data.id],
      );
      const other = await questions(ids.other, slides.id);
      expect(other.status).toBe(200);
      expect(other.headers["cache-control"]).toBe("private, no-store");
      expect(other.body).toMatchObject({
        resourceId: slides.id,
        fileId: slides.fileId,
        earlierVersionCount: 0,
      });
      expect(other.body.data.map((entry: { id: string }) => entry.id)).toEqual([
        first.body.data.id,
        later.body.data.id,
      ]);
      expect(other.body.data[0]).toEqual({
        id: first.body.data.id,
        type: "question",
        title: "Page 3",
        page: 3,
        box,
        answered: false,
        unresolvedFollowups: 0,
        unread: true,
        createdAt: first.body.data.createdAt,
      });
      const staff = await questions(ids.staff, slides.id);
      expect(staff.body.data.map((entry: { id: string }) => entry.id)).toEqual([
        first.body.data.id,
        secret.body.data.id,
        later.body.data.id,
      ]);
      const author = await questions(ids.author, slides.id);
      expect(author.body.data).toHaveLength(3);
    });

    it("counts questions on earlier files separately", async () => {
      const slides = await resource();
      await createPost(ids.author, anchored(slides));
      await createPost(ids.other, anchored(slides));
      const fileId = await replace(slides.id);
      const current = await createPost(
        ids.author,
        anchored({ id: slides.id, fileId }),
      );
      const listed = await questions(ids.other, slides.id);
      expect(listed.body.fileId).toBe(fileId);
      expect(listed.body.data.map((entry: { id: string }) => entry.id)).toEqual(
        [current.body.data.id],
      );
      expect(listed.body.earlierVersionCount).toBe(2);
    });

    it("hides resources the caller cannot read as missing", async () => {
      const staffOnly = await resource({ sectionId: ids.staffSection });
      const link = await resource({ link: true });
      const docx = await resource({ mediaType: "text/plain" });
      for (const id of [uuidv7(), staffOnly.id, link.id, docx.id, "nope"]) {
        const response = await questions(ids.author, id);
        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe("not_found");
      }
      expect((await questions(ids.staff, staffOnly.id)).status).toBe(200);
      const slides = await resource();
      expect((await questions(ids.outsider, slides.id)).status).toBe(404);
      const anonymous = await request(app(ids.author)).get(
        `/api/v1/courses/${ids.course}/resources/${slides.id}/questions`,
      );
      expect(anonymous.status).toBe(401);
    });
  });
});
