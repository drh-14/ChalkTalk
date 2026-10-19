import { Pool } from "pg";
import { zipSync, strToU8 } from "fflate";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { AnswerService } from "../answers/service.js";
import { FollowupService } from "../followups/service.js";
import { PostService } from "../posts/service.js";
import { ContentAttachmentService } from "../content-attachments/service.js";
import { CourseFileService } from "../course-files/service.js";
import { JobWorker } from "../jobs/worker.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const endpoint = process.env.TEST_S3_ENDPOINT;
const integration = databaseUrl && endpoint ? describe : describe.skip;
const schema = `attachments_${process.pid}_${Date.now()}`;
const bucket = `attachments-test-${process.pid}-${Date.now()}`;
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  author: uuidv7(),
  student: uuidv7(),
  staff: uuidv7(),
  outsider: uuidv7(),
  question: uuidv7(),
  note: uuidv7(),
  answer: uuidv7(),
  staffAnswer: uuidv7(),
  followup: uuidv7(),
  reply: uuidv7(),
};
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082",
  "hex",
);
const docx = Buffer.from(
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
    ),
  }),
);
const pptx = Buffer.from(
  zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    ),
    "ppt/presentation.xml": strToU8(
      '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    ),
  }),
);
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const s3 = new S3Client({
  region: "us-east-1",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
    secretAccessKey:
      process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
  },
});
let admin: Pool;
let pool: Pool;

function app(userId: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: uuidv7(),
        user: {
          id: userId,
          email: "user@example.edu",
          displayName: "User",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        csrfToken: "csrf",
      }),
    } as AuthService,
    postService: new PostService(pool),
    answerService: new AnswerService(pool),
    followupService: new FollowupService(pool),
    contentAttachmentService: new ContentAttachmentService(pool, s3, bucket),
    courseFileService: new CourseFileService(pool, s3, bucket),
  });
}
function upload(
  userId: string,
  path: string,
  key = uuidv7(),
  file: { name: string; type: string; bytes: Buffer } = {
    name: "diagram.png",
    type: "image/png",
    bytes: png,
  },
) {
  return request(app(userId))
    .post(path)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf")
    .set("Idempotency-Key", key)
    .attach("file", file.bytes, {
      filename: file.name,
      contentType: file.type,
    });
}
function bytes(
  stream: NodeJS.ReadableStream,
  done: (error: Error | null, value?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
  stream.on("error", done);
}

integration("parent-scoped attachments HTTP contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path="${schema}"`,
      application_name: schema,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [id, name] of [
      [ids.author, "Author"],
      [ids.student, "Student"],
      [ids.staff, "Staff"],
      [ids.outsider, "Outsider"],
    ])
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name.toLowerCase()}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.org, ids.author],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student'),($1,$3,'student'),($1,$4,'ta')",
      [ids.course, ids.author, ids.student, ids.staff],
    );
    for (const [id, type] of [
      [ids.question, "question"],
      [ids.note, "note"],
    ])
      await pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,$4,'Title','Body')",
        [id, ids.course, ids.author, type],
      );
    const answers = new AnswerService(pool);
    ids.answer = (
      await answers.create(ids.question, ids.author, {
        bodyMarkdown: "Answer",
      })
    ).value.id;
    ids.staffAnswer = (
      await answers.create(ids.question, ids.staff, {
        bodyMarkdown: "Staff answer",
      })
    ).value.id;
    await pool.query(
      "INSERT INTO followups (id,course_id,post_id,author_user_id,body_markdown) VALUES ($1,$2,$3,$4,'Followup')",
      [ids.followup, ids.course, ids.question, ids.author],
    );
    await pool.query(
      "INSERT INTO followups (id,course_id,post_id,parent_followup_id,author_user_id,body_markdown) VALUES ($1,$2,$3,$4,$5,'Reply')",
      [ids.reply, ids.course, ids.question, ids.followup, ids.student],
    );
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    for (const object of objects.Contents ?? [])
      if (object.Key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  });

  it("uploads a post image and downloads exact original bytes to a member", async () => {
    const created = await upload(
      ids.author,
      `/api/v1/posts/${ids.question}/attachments`,
      "question-diagram",
    );
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      fileName: "diagram.png",
      mediaType: "image/png",
      sizeBytes: png.length,
    });
    expect(created.body.data).not.toHaveProperty("uploadedByUserId");
    const attachmentId = created.body.data.id as string;
    const post = await request(app(ids.student))
      .get(`/api/v1/posts/${ids.question}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(post.body.data.attachments).toEqual([
      expect.objectContaining({ id: attachmentId, fileName: "diagram.png" }),
    ]);
    const downloaded = await request(app(ids.student))
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .buffer(true)
      .parse(bytes);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toMatch(/^inline;/);
    expect(downloaded.body).toEqual(png);
    expect(created.headers.location).toBe(created.body.data.downloadUrl);
    expect(downloaded.headers["cache-control"]).toBe("private, no-store");
    expect(downloaded.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (
        await request(app(ids.outsider))
          .get(`/api/v1/attachments/${attachmentId}/download`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
  });

  it("requires authentication and CSRF, without granting standalone course-file rights", async () => {
    const path = `/api/v1/posts/${ids.question}/attachments`;
    expect(
      (
        await request(app(ids.author))
          .post(path)
          .set("Origin", environment.frontendBaseUrl)
          .attach("file", png, "image.png")
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app(ids.author))
          .post(path)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .attach("file", png, "image.png")
      ).status,
    ).toBe(403);
    expect(
      (await upload(ids.student, `/api/v1/courses/${ids.course}/files`)).status,
    ).toBe(403);
    const attachment = await upload(ids.author, path);
    expect(attachment.status).toBe(201);
    expect(
      (await request(app(ids.author)).get(attachment.body.data.downloadUrl))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app(ids.author))
          .delete(`/api/v1/attachments/${attachment.body.data.id}`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
      ).status,
    ).toBe(403);
  });

  it("round trips validated PPTX bytes through a note attachment", async () => {
    const attachment = await upload(
      ids.author,
      `/api/v1/posts/${ids.note}/attachments`,
      uuidv7(),
      {
        name: "slides.pptx",
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        bytes: pptx,
      },
    );
    expect(attachment.status).toBe(201);
    const downloaded = await request(app(ids.student))
      .get(attachment.body.data.downloadUrl)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .buffer(true)
      .parse(bytes);
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toEqual(pptx);
    expect(downloaded.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  it("rejects ambiguous and cross-course attachment parents at the database boundary", async () => {
    const otherCourse = uuidv7();
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Other','HGFEDCBA')",
      [otherCourse, ids.org, ids.author],
    );
    const insert = (
      id: string,
      courseId: string,
      postId: string | null,
      answerId: string | null,
    ) =>
      pool.query(
        "INSERT INTO content_attachments (id,course_id,post_id,answer_id,object_key,file_name,media_type,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,$5,'x.png','image/png',1,$6)",
        [id, courseId, postId, answerId, `invalid/${id}`, Buffer.alloc(32)],
      );
    await expect(
      insert(uuidv7(), ids.course, ids.question, ids.answer),
    ).rejects.toThrow();
    await expect(
      insert(uuidv7(), otherCourse, ids.question, null),
    ).rejects.toThrow();
  });

  it("allows notes and author-owned followups, but applies the staff-answer role floor", async () => {
    expect(
      (await upload(ids.author, `/api/v1/posts/${ids.note}/attachments`))
        .status,
    ).toBe(201);
    const followup = await upload(
      ids.author,
      `/api/v1/followups/${ids.followup}/attachments`,
    );
    expect(followup.status).toBe(201);
    expect(
      (
        await upload(
          ids.student,
          `/api/v1/followups/${ids.followup}/attachments`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await upload(
          ids.student,
          `/api/v1/answers/${ids.staffAnswer}/attachments`,
        )
      ).status,
    ).toBe(403);
    const answer = await upload(
      ids.staff,
      `/api/v1/answers/${ids.staffAnswer}/attachments`,
    );
    expect(answer.status).toBe(201);
    const detail = await request(app(ids.student))
      .get(`/api/v1/answers/${ids.staffAnswer}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(detail.body.data.attachments).toEqual([
      expect.objectContaining({ id: answer.body.data.id }),
    ]);
    expect(detail.body.data.contributors).toEqual([
      expect.objectContaining({ id: ids.staff }),
    ]);
    const followupDetail = await request(app(ids.student))
      .get(`/api/v1/followups/${ids.followup}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(followupDetail.body.data.attachments).toEqual([
      expect.objectContaining({ id: followup.body.data.id }),
    ]);
  });

  it("serves a validated document as a download and rejects disguised images", async () => {
    const document = await upload(
      ids.author,
      `/api/v1/answers/${ids.answer}/attachments`,
      uuidv7(),
      {
        name: "notes.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        bytes: docx,
      },
    );
    expect(document.status).toBe(201);
    const downloaded = await request(app(ids.student))
      .get(`/api/v1/attachments/${document.body.data.id}/download`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .buffer(true)
      .parse(bytes);
    expect(downloaded.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(downloaded.body).toEqual(docx);
    const disguised = await upload(
      ids.author,
      `/api/v1/answers/${ids.answer}/attachments`,
      uuidv7(),
      {
        name: "fake.png",
        type: "image/png",
        bytes: Buffer.from("<script>alert(1)</script>"),
      },
    );
    expect(disguised.status).toBe(415);
  });

  it("uses reply-author permissions and hides a deleted root's attachment but not its reply", async () => {
    const rootAttachment = await upload(
      ids.author,
      `/api/v1/followups/${ids.followup}/attachments`,
    );
    expect(rootAttachment.status).toBe(201);
    const replyAttachment = await upload(
      ids.student,
      `/api/v1/followups/${ids.reply}/attachments`,
    );
    expect(replyAttachment.status).toBe(201);
    expect(
      (await upload(ids.author, `/api/v1/followups/${ids.reply}/attachments`))
        .status,
    ).toBe(403);
    const root = await request(app(ids.author))
      .get(`/api/v1/followups/${ids.followup}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    const rootAttachmentId = rootAttachment.body.data.id as string;
    const deleted = await request(app(ids.author))
      .delete(`/api/v1/followups/${ids.followup}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", root.headers.etag);
    expect(deleted.status).toBe(204);
    const tombstone = await request(app(ids.student))
      .get(`/api/v1/followups/${ids.followup}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(tombstone.body.data).toMatchObject({
      deleted: true,
      attachments: [],
    });
    expect(
      (
        await request(app(ids.student))
          .get(`/api/v1/attachments/${rootAttachmentId}/download`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    const reply = await request(app(ids.author))
      .get(`/api/v1/followups/${ids.reply}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(reply.body.data.attachments).toEqual([
      expect.objectContaining({ id: replyAttachment.body.data.id }),
    ]);
  });

  it("replays the exact upload and rejects a sixth active file", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'note','Replay cap','Body')",
      [postId, ids.course, ids.author],
    );
    const path = `/api/v1/posts/${postId}/attachments`;
    const initial = await upload(ids.author, path, "note-retry");
    const replay = await upload(ids.author, path, "note-retry");
    expect(initial.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(initial.body.data.id);
    const changed = await upload(ids.author, path, "note-retry", {
      name: "diagram.png",
      type: "image/png",
      bytes: Buffer.concat([png, Buffer.from("different")]),
    });
    expect(changed.status).toBe(409);
    for (let index = 0; index < 4; index++)
      expect((await upload(ids.author, path)).status).toBe(201);
    expect((await upload(ids.author, path)).status).toBe(413);
  });

  it("allows a reused idempotency key after its retention window expires", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'note','Key rotation','Body')",
      [postId, ids.course, ids.author],
    );
    const path = `/api/v1/posts/${postId}/attachments`;
    const initial = await upload(ids.author, path, "expiring-attachment-key");
    expect(initial.status).toBe(201);
    await pool.query(
      "UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE scope=$1 AND key=$2",
      [
        `content-attachment-create:${ids.author}:post:${postId}`,
        "expiring-attachment-key",
      ],
    );
    const later = await upload(ids.author, path, "expiring-attachment-key");
    expect(later.status).toBe(201);
    expect(later.body.data.id).not.toBe(initial.body.data.id);
  });

  it.each(["answers", "followups", "mixed"] as const)(
    "serializes concurrent attachment uploads across sibling %s without lock-upgrade deadlocks",
    async (parents) => {
      const postId = uuidv7();
      await pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Sibling attachment race','Question')",
        [postId, ids.course, ids.author],
      );
      const makeAnswer = async (userId: string) =>
        (
          await new AnswerService(pool).create(postId, userId, {
            bodyMarkdown: "Sibling answer",
          })
        ).value.id;
      const makeFollowup = async () =>
        (
          await new FollowupService(pool).create(postId, ids.staff, {
            bodyMarkdown: "Sibling followup",
          })
        ).id;
      const firstKind = parents === "followups" ? "followups" : "answers";
      const secondKind = parents === "answers" ? "answers" : "followups";
      const firstId =
        firstKind === "answers"
          ? await makeAnswer(ids.author)
          : await makeFollowup();
      const secondId =
        secondKind === "answers"
          ? await makeAnswer(ids.staff)
          : await makeFollowup();
      let releaseFirst!: () => void;
      let firstReached!: () => void;
      const firstReady = new Promise<void>((resolve) => {
        firstReached = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let puts = 0;
      s3.middlewareStack.add(
        (next, context) => async (args) => {
          if (context.commandName === "PutObjectCommand" && ++puts === 1) {
            firstReached();
            await firstGate;
          }
          return next(args);
        },
        { step: "initialize", name: "siblingUploadGate" },
      );
      let first: Promise<request.Response> | undefined;
      let second: Promise<request.Response> | undefined;
      try {
        first = upload(
          ids.staff,
          `/api/v1/${firstKind}/${firstId}/attachments`,
        ).then((value) => value);
        await firstReady;
        second = upload(
          ids.staff,
          `/api/v1/${secondKind}/${secondId}/attachments`,
        ).then((value) => value);
        // Wait until the second public request reaches a database lock. This works
        // for both the old shared-lock upgrade and the corrected parent serialization.
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const locks = await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'",
            [schema],
          );
          waiting = !!locks.rowCount;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        releaseFirst();
        const results = await Promise.all([first, second]);
        expect(
          results.map((value) => value.status),
          JSON.stringify(results.map((value) => value.body)),
        ).toEqual([201, 201]);
        for (const [kind, id] of [
          [firstKind, firstId],
          [secondKind, secondId],
        ]) {
          const detail = await request(app(ids.staff))
            .get(`/api/v1/${kind}/${id}`)
            .set("Cookie", "__Host-chalktalk_session=opaque");
          expect(detail.status).toBe(200);
          expect(detail.body.data.attachments).toHaveLength(1);
        }
      } finally {
        releaseFirst();
        await Promise.allSettled([first, second]);
        s3.middlewareStack.remove("siblingUploadGate");
      }
    },
  );

  it("serializes an attachment upload with a normal sibling followup text save", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Attachment and text race','Question')",
      [postId, ids.course, ids.author],
    );
    const service = new FollowupService(pool);
    const firstParent = await service.create(postId, ids.staff, {
      bodyMarkdown: "First followup",
    });
    const secondParent = await service.create(postId, ids.staff, {
      bodyMarkdown: "Second followup",
    });
    let release!: () => void;
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    s3.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === "PutObjectCommand") {
          reached();
          await gate;
        }
        return next(args);
      },
      { step: "initialize", name: "followupTextUploadGate" },
    );
    let uploading: Promise<request.Response> | undefined;
    let editing: Promise<request.Response> | undefined;
    try {
      uploading = upload(
        ids.staff,
        `/api/v1/followups/${firstParent.id}/attachments`,
      ).then((value) => value);
      await ready;
      editing = request(app(ids.staff))
        .patch(`/api/v1/followups/${secondParent.id}`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .set("If-Match", '"v1"')
        .send({ bodyMarkdown: "Saved sibling text" })
        .then((value) => value);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = !!(
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type='Lock'",
            [schema],
          )
        ).rowCount;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release();
      const [attachment, saved] = await Promise.all([uploading, editing]);
      expect(attachment.status, JSON.stringify(attachment.body)).toBe(201);
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.data.bodyMarkdown).toBe("Saved sibling text");
      const detail = await request(app(ids.staff))
        .get(`/api/v1/followups/${firstParent.id}`)
        .set("Cookie", "__Host-chalktalk_session=opaque");
      expect(detail.body.data.attachments).toHaveLength(1);
      expect(detail.body.data.bodyMarkdown).toBe("First followup");
    } finally {
      release();
      await Promise.allSettled([uploading, editing]);
      s3.middlewareStack.remove("followupTextUploadGate");
    }
  });

  it("keeps the five-file cap when uploads race", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'note','Concurrent files','Body')",
      [postId, ids.course, ids.author],
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        upload(ids.author, `/api/v1/posts/${postId}/attachments`),
      ),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(5);
    expect(results.filter((result) => result.status === 413)).toHaveLength(1);
    const stored = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_attachments WHERE post_id=$1 AND deleted_at IS NULL",
      [postId],
    );
    expect(stored.rows[0].count).toBe("5");
  });

  it("clears a staff answer endorsement but retains its historical event", async () => {
    const before = await request(app(ids.staff))
      .get(`/api/v1/answers/${ids.staffAnswer}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    const endorsed = await request(app(ids.staff))
      .put(`/api/v1/answers/${ids.staffAnswer}/endorsement`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", before.headers.etag);
    expect(endorsed.status).toBe(200);
    expect(
      (
        await upload(
          ids.staff,
          `/api/v1/answers/${ids.staffAnswer}/attachments`,
        )
      ).status,
    ).toBe(201);
    const answer = await pool.query<{ endorsed_at: Date | null }>(
      "SELECT endorsed_at FROM answers WHERE id=$1",
      [ids.staffAnswer],
    );
    const events = await pool.query(
      "SELECT id FROM answer_endorsement_events WHERE answer_id=$1",
      [ids.staffAnswer],
    );
    expect(answer.rows[0].endorsed_at).toBeNull();
    expect(events.rowCount).toBe(1);
    const detail = await request(app(ids.staff))
      .get(`/api/v1/answers/${ids.staffAnswer}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    const revised = await request(app(ids.staff))
      .patch(`/api/v1/answers/${ids.staffAnswer}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", detail.headers.etag)
      .send({ bodyMarkdown: "Corrected staff answer" });
    expect(revised.status).toBe(200);
  });

  it("removes an attachment immediately and lets the worker delete its bytes", async () => {
    const created = await upload(
      ids.author,
      `/api/v1/answers/${ids.answer}/attachments`,
    );
    expect(created.status).toBe(201);
    const attachmentId = created.body.data.id as string;
    const denied = await request(app(ids.outsider))
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
    expect(denied.status, JSON.stringify(denied.body)).toBe(404);
    const removed = await request(app(ids.student))
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
    expect(removed.status).toBe(204);
    const hidden = await request(app(ids.author))
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(hidden.status).toBe(404);
    const queued = await pool.query<{ object_key: string }>(
      "SELECT payload->>'objectKey' AS object_key FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key=$1",
      [`attachment-delete:${attachmentId}`],
    );
    expect(queued.rowCount).toBe(1);
    const worker = new JobWorker(
      pool,
      "attachments-test",
      undefined,
      undefined,
      {
        client: s3,
        bucket,
      },
    );
    let status = "queued";
    for (let attempt = 0; attempt < 5 && status !== "succeeded"; attempt++) {
      expect(await worker.runOnce()).toBe(true);
      status = (
        await pool.query<{ status: string }>(
          "SELECT status FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key=$1",
          [`attachment-delete:${attachmentId}`],
        )
      ).rows[0].status;
    }
    expect(status).toBe("succeeded");
    await expect(
      s3.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: queued.rows[0].object_key,
        }),
      ),
    ).rejects.toThrow();
  });

  it("hides a duplicate source's files and restores them on unmerge", async () => {
    const sourceId = uuidv7();
    const canonicalId = uuidv7();
    for (const id of [sourceId, canonicalId])
      await pool.query(
        "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Title','Body')",
        [id, ids.course, ids.author],
      );
    const created = await upload(
      ids.author,
      `/api/v1/posts/${sourceId}/attachments`,
    );
    expect(created.status).toBe(201);
    const merged = await request(app(ids.staff))
      .patch(`/api/v1/posts/${sourceId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", '"v2"')
      .send({ duplicateStatus: "confirmed", duplicateOfPostId: canonicalId });
    expect(merged.status).toBe(200);
    const review = await request(app(ids.staff))
      .get(`/api/v1/posts/${sourceId}/duplicate-review`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(review.status).toBe(200);
    expect(review.body.data.attachments).toEqual([]);
    expect(
      (
        await request(app(ids.author))
          .get(`/api/v1/attachments/${created.body.data.id}/download`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    const unmerged = await request(app(ids.staff))
      .patch(`/api/v1/posts/${sourceId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", merged.headers.etag)
      .send({ duplicateStatus: "none", duplicateOfPostId: null });
    expect(unmerged.status).toBe(200);
    expect(unmerged.body.data.attachments).toEqual([
      expect.objectContaining({ id: created.body.data.id }),
    ]);
  });

  it("preserves anonymous contributor privacy and hides answer attachments on parent deletion", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Anonymous contributors','Question')",
      [postId, ids.course, ids.author],
    );
    const answer = (
      await new AnswerService(pool).create(postId, ids.author, {
        bodyMarkdown: "Anonymous answer",
        anonymous: true,
      })
    ).value;
    const added = await upload(
      ids.student,
      `/api/v1/answers/${answer.id}/attachments`,
    );
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const memberView = await request(app(ids.author))
      .get(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(memberView.body.data.contributors).toBeNull();
    expect(memberView.body.data.attachments).toEqual([
      expect.objectContaining({ id: added.body.data.id }),
    ]);
    expect(memberView.body.data.attachments[0]).not.toHaveProperty(
      "uploadedByUserId",
    );
    const staffView = await request(app(ids.staff))
      .get(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(
      staffView.body.data.contributors
        .map((person: { id: string }) => person.id)
        .sort(),
    ).toEqual([ids.author, ids.student].sort());
    const removed = await request(app(ids.staff))
      .delete(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", staffView.headers.etag);
    expect(removed.status).toBe(204);
    expect(
      (
        await request(app(ids.student))
          .get(added.body.data.downloadUrl)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    const queued = await pool.query(
      "SELECT id FROM jobs WHERE kind='delete_content_attachment' AND deduplication_key=$1",
      [`attachment-delete:${added.body.data.id}`],
    );
    expect(queued.rowCount).toBe(1);
  });

  it("replays simultaneous identical uploads without duplicate objects or parent versions", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'note','Simultaneous retry','Body')",
      [postId, ids.course, ids.author],
    );
    const path = `/api/v1/posts/${postId}/attachments`;
    const [first, replayed] = await Promise.all([
      upload(ids.author, path, "simultaneous-key"),
      upload(ids.author, path, "simultaneous-key"),
    ]);
    expect(first.status).toBe(201);
    expect(replayed.status).toBe(201);
    expect(replayed.body).toEqual(first.body);
    const detail = await request(app(ids.author))
      .get(`/api/v1/posts/${postId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(detail.body.data.attachments).toHaveLength(1);
    expect(detail.headers.etag).toBe('"v2"');
    const objects = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `courses/${ids.course}/attachments/${first.body.data.id}`,
      }),
    );
    expect(objects.Contents).toHaveLength(1);
  });

  it("version-checks Markdown saves against attachment mutations and preserves both on races", async () => {
    const postId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'question','Concurrent edits','Question')",
      [postId, ids.course, ids.author],
    );
    const answer = (
      await new AnswerService(pool).create(postId, ids.author, {
        bodyMarkdown: "Initial answer",
      })
    ).value;
    const initial = await request(app(ids.author))
      .get(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    const attachment = await upload(
      ids.author,
      `/api/v1/answers/${answer.id}/attachments`,
    );
    expect(attachment.status).toBe(201);
    const save = (etag: string, text: string) =>
      request(app(ids.student))
        .patch(`/api/v1/answers/${answer.id}`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .set("If-Match", etag)
        .send({ bodyMarkdown: text });
    const stale = await save(initial.headers.etag, "Stale draft");
    expect(stale.status).toBe(412);
    const current = await request(app(ids.author))
      .get(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(current.body.data.bodyMarkdown).toBe("Initial answer");
    expect(current.body.data.attachments).toHaveLength(1);
    const [saved, added] = await Promise.all([
      save(current.headers.etag, "Updated answer"),
      upload(ids.author, `/api/v1/answers/${answer.id}/attachments`),
    ]);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect([200, 412]).toContain(saved.status);
    const latest = await request(app(ids.author))
      .get(`/api/v1/answers/${answer.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(latest.body.data.attachments).toHaveLength(2);
    expect(latest.body.data.bodyMarkdown).toBe(
      saved.status === 200 ? "Updated answer" : "Initial answer",
    );
    expect(latest.body.data.version).toBe(3 + (saved.status === 200 ? 1 : 0));
    const removed = await request(app(ids.student))
      .delete(`/api/v1/attachments/${attachment.body.data.id}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
    expect(removed.status).toBe(204);
    expect(
      (await save(latest.headers.etag, "Stale after removal")).status,
    ).toBe(412);
  });

  it("hides attachments and queues object cleanup when a post is deleted", async () => {
    const attachment = await upload(
      ids.author,
      `/api/v1/posts/${ids.question}/attachments`,
    );
    expect(attachment.status).toBe(201);
    const post = await request(app(ids.author))
      .get(`/api/v1/posts/${ids.question}`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    const deletion = await request(app(ids.author))
      .delete(`/api/v1/posts/${ids.question}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", post.headers.etag);
    expect(deletion.status).toBe(204);
    const download = await request(app(ids.author))
      .get(`/api/v1/attachments/${attachment.body.data.id}/download`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(download.status).toBe(404);
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE kind='delete_content_attachment' AND payload->>'objectKey' IN (SELECT object_key FROM content_attachments WHERE post_id=$1)",
      [ids.question],
    );
    expect(jobs.rowCount).toBeGreaterThanOrEqual(1);
  });

  it("keeps archived attachments download-only and cleans all bytes on course deletion", async () => {
    const archivePostId = uuidv7();
    await pool.query(
      "INSERT INTO posts (id,course_id,author_user_id,type,title,body_markdown) VALUES ($1,$2,$3,'note','Archive test','Body')",
      [archivePostId, ids.course, ids.author],
    );
    const path = `/api/v1/posts/${archivePostId}/attachments`;
    const created = await upload(ids.author, path, "archive-replay");
    expect(created.status).toBe(201);
    const attachmentId = created.body.data.id as string;
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    const archivedRead = await request(app(ids.student))
      .get(`/api/v1/attachments/${attachmentId}/download`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(archivedRead.status).toBe(200);
    const archivedReplay = await upload(ids.author, path, "archive-replay");
    expect(archivedReplay.status).toBe(201);
    expect((await upload(ids.author, path)).status).toBe(409);
    const archivedDeletion = await request(app(ids.author))
      .delete(`/api/v1/attachments/${attachmentId}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
    expect(archivedDeletion.status).toBe(409);
    await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
      ids.course,
    ]);
    const courseJob = uuidv7();
    await pool.query(
      "INSERT INTO jobs (id,kind,payload) VALUES ($1,'delete_course',$2)",
      [courseJob, { courseId: ids.course }],
    );
    const worker = new JobWorker(
      pool,
      "attachment-course-delete",
      undefined,
      undefined,
      { client: s3, bucket },
    );
    let status = "queued";
    for (let attempt = 0; attempt < 30 && status !== "succeeded"; attempt++) {
      await worker.runOnce();
      status = (
        await pool.query<{ status: string }>(
          "SELECT status FROM jobs WHERE id=$1",
          [courseJob],
        )
      ).rows[0].status;
    }
    expect(status).toBe("succeeded");
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(objects.Contents ?? []).toEqual([]);
  });
});
