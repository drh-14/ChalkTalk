import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { zipSync, strToU8 } from "fflate";
import { Pool } from "pg";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { createApp } from "./app.js";
import { CourseFileService } from "../course-files/service.js";
import { JobWorker } from "../jobs/worker.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.TEST_S3_ENDPOINT;
const integration = databaseUrl && s3Endpoint ? describe : describe.skip;
const schema = `course_files_${process.pid}_${Date.now()}`;
const bucket = `chalktalk-test-${process.pid}-${Date.now()}`;
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: s3Endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "chalktalk-local",
    secretAccessKey:
      process.env.TEST_S3_SECRET_ACCESS_KEY ?? "chalktalk-local-secret",
  },
});
const ids = {
  org: uuidv7(),
  course: uuidv7(),
  instructor: uuidv7(),
  otherInstructor: uuidv7(),
  ta: uuidv7(),
  student: uuidv7(),
  outsider: uuidv7(),
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        csrfToken: "csrf",
      }),
    } as AuthService,
    courseFileService: new CourseFileService(pool, s3, bucket),
  });
}
function upload(
  userId: string,
  name: string,
  mime: string,
  bytes: Buffer,
  key?: string,
) {
  let call = request(app(userId))
    .post(`/api/v1/courses/${ids.course}/files`)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf")
    .attach("file", bytes, { filename: name, contentType: mime });
  if (key) call = call.set("Idempotency-Key", key);
  return call;
}
async function createStaged(service: CourseFileService, key?: string) {
  const directory = await fs.mkdtemp(join(tmpdir(), "course-file-service-"));
  const filePath = join(directory, "image.png");
  try {
    await fs.writeFile(filePath, png);
    return await service.create(
      ids.course,
      ids.instructor,
      {
        fileName: "image.png",
        declaredType: "image/png",
        filePath,
        sizeBytes: png.length,
        cleanup: async () => {},
      },
      key,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082",
  "hex",
);
const jpeg = await sharp(Buffer.from([255, 0, 0]), {
  raw: { width: 1, height: 1, channels: 3 },
})
  .jpeg()
  .toBuffer();
const webp = await sharp(Buffer.from([255, 0, 0]), {
  raw: { width: 1, height: 1, channels: 3 },
})
  .webp()
  .toBuffer();
const pdfDocument = await PDFDocument.create();
pdfDocument.addPage([100, 100]);
const pdf = Buffer.from(await pdfDocument.save());
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
function asBytes(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, bytes?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", callback);
}
function asDigest(
  response: NodeJS.ReadableStream,
  callback: (
    error: Error | null,
    result?: { size: number; sha256: string },
  ) => void,
) {
  const hash = createHash("sha256");
  let size = 0;
  response.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });
  response.on("end", () =>
    callback(null, { size, sha256: hash.digest("hex") }),
  );
  response.on("error", callback);
}

integration("course file upload and byte download", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [id, name] of [
      [ids.instructor, "Instructor"],
      [ids.otherInstructor, "OtherInstructor"],
      [ids.ta, "TA"],
      [ids.student, "Student"],
      [ids.outsider, "Outsider"],
    ])
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, ids.org, `${name.toLowerCase()}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Physics','ABCDEFGH')",
      [ids.course, ids.org, ids.instructor],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor'),($1,$3,'ta'),($1,$4,'student'),($1,$5,'instructor')",
      [ids.course, ids.instructor, ids.ta, ids.student, ids.otherInstructor],
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
    s3.destroy();
  });
  it("creates a course file without resource metadata", async () => {
    const response = await request(app(ids.instructor))
      .post(`/api/v1/courses/${ids.course}/files`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .attach("file", png, {
        filename: "image.png",
        contentType: "image/png",
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.headers.location).toMatch(
      new RegExp(`^/api/v1/courses/${ids.course}/files/`),
    );
    expect(response.body.data).toMatchObject({
      courseId: ids.course,
      fileName: "image.png",
      mediaType: "image/png",
      sizeBytes: png.length,
    });
    expect(response.body.data).not.toHaveProperty("title");
    expect(
      (
        await request(app(ids.student))
          .get(`/api/v1/courses/${ids.course}/files/${response.body.data.id}`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(ids.student))
          .get(`/api/v1/resources/${response.body.data.id}/download`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
  });
  it("lists live metadata for members with exact timestamp pagination and course isolation", async () => {
    const fileA = (
      await upload(ids.instructor, "list-a.txt", "text/plain", Buffer.from("a"))
    ).body.data;
    const fileB = (
      await upload(ids.instructor, "list-b.txt", "text/plain", Buffer.from("b"))
    ).body.data;
    await pool.query(
      "UPDATE course_files SET created_at='2090-01-01T00:00:00.123456Z' WHERE id=ANY($1)",
      [[fileA.id, fileB.id]],
    );
    const list = (user: string, query = "") =>
      request(app(user))
        .get(`/api/v1/courses/${ids.course}/files${query}`)
        .set("Cookie", "__Host-chalktalk_session=opaque");
    const first = await list(ids.student, "?limit=1");
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.page).toEqual({
      hasMore: true,
      nextCursor: expect.any(String),
    });
    expect(first.body.data).toEqual([
      { ...fileB, createdAt: "2090-01-01T00:00:00.123Z" },
    ]);
    const second = await list(
      ids.ta,
      `?limit=1&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.data.map((file: { id: string }) => file.id)).toEqual([
      fileA.id,
    ]);
    expect(Object.keys(second.body.data[0]).sort()).toEqual([
      "courseId",
      "createdAt",
      "fileName",
      "id",
      "mediaType",
      "sizeBytes",
    ]);
    await pool.query("UPDATE course_files SET deleted_at=now() WHERE id=$1", [
      fileB.id,
    ]);
    expect(
      (await list(ids.instructor)).body.data.some(
        (file: { id: string }) => file.id === fileB.id,
      ),
    ).toBe(false);
    expect((await list(ids.outsider)).status).toBe(404);
    expect(
      (
        await request(app(ids.student))
          .get(`/api/v1/courses/${uuidv7()}/files`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    expect((await list(ids.student)).status).toBe(200);
    await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
      ids.course,
    ]);
    expect((await list(ids.student)).status).toBe(404);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      ids.course,
    ]);
    expect(
      (
        await request(app(ids.student)).get(
          `/api/v1/courses/${ids.course}/files`,
        )
      ).status,
    ).toBe(401);
    await pool.query(
      "UPDATE course_files SET created_at=now() WHERE id=ANY($1)",
      [[fileA.id, fileB.id]],
    );
  });

  it("rejects invalid list queries and cross-course cursors with an error envelope", async () => {
    const list = (query: string) =>
      request(app(ids.student))
        .get(`/api/v1/courses/${ids.course}/files?${query}`)
        .set("Cookie", "__Host-chalktalk_session=opaque");
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=1e1",
      "limit=",
      "limit=1&limit=2",
      "limit[x]=1",
      "search=x",
      "cursor=",
      "cursor=bad",
      "cursor=x&cursor=y",
      `cursor=${encoded([uuidv7(), "2090-01-01T00:00:00.123456Z", uuidv7()])}`,
      `cursor=${encoded([ids.course, "2090-02-30T00:00:00.123456Z", uuidv7()])}`,
      `cursor=${encoded([ids.course, "2090-01-01T00:00:00.123Z", uuidv7()])}`,
      `cursor=${encoded([ids.course, "2090-01-01T00:00:00.123456Z", "bad"])}`,
    ]) {
      const result = await list(query);
      expect(result.status, query).toBe(400);
      expect(result.body.error.code).toBe("invalid_request");
      expect(result.body.error.requestId).toEqual(expect.any(String));
    }
  });
  it("isolates files between courses and hides removed or deleted members", async () => {
    const otherCourse = uuidv7();
    await pool.query(
      "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code) VALUES ($1,$2,$3,'Other','OTHER123')",
      [otherCourse, ids.org, ids.instructor],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [otherCourse, ids.student],
    );
    const list = () =>
      request(app(ids.student))
        .get(`/api/v1/courses/${otherCourse}/files`)
        .set("Cookie", "__Host-chalktalk_session=opaque");
    const empty = await list();
    expect(empty.status).toBe(200);
    expect(empty.headers["cache-control"]).toBe("private, no-store");
    expect(empty.body).toEqual({
      data: [],
      page: { hasMore: false, nextCursor: null },
    });
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [otherCourse, ids.student],
    );
    expect((await list()).status).toBe(404);
    await pool.query(
      "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
      [otherCourse, ids.student],
    );
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.student,
    ]);
    expect((await list()).status).toBe(404);
    await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
      ids.student,
    ]);
  });

  for (const [name, mime, bytes] of [
    ["lecture.pdf", "application/pdf", pdf],
    ["image.png", "image/png", png],
    ["photo.jpg", "image/jpeg", jpeg],
    ["photo.webp", "image/webp", webp],
    ["notes.txt", "text/plain", Buffer.from("Lecture notes\n")],
    ["readme.md", "text/markdown", Buffer.from("# Lecture\n")],
    [
      "notes.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      docx,
    ],
    [
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      pptx,
    ],
  ] as const) {
    it(`round trips exact ${name} bytes and checks current membership`, async () => {
      const created = await upload(ids.instructor, name, mime, bytes);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.headers.location).toMatch(
        new RegExp(`^/api/v1/courses/${ids.course}/files/[^/]+/download$`),
      );
      expect(created.body.data).toMatchObject({
        courseId: ids.course,
        fileName: name,
        mediaType: mime,
        sizeBytes: bytes.length,
      });
      const path = created.headers.location;
      const downloaded = await request(app(ids.student))
        .get(path)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .buffer(true)
        .parse(asBytes);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers["content-type"]).toContain(mime);
      expect(downloaded.headers["content-disposition"]).toContain("attachment");
      expect(downloaded.headers["cache-control"]).toBe("private, no-store");
      expect(downloaded.headers["x-content-type-options"]).toBe("nosniff");
      expect(downloaded.body).toEqual(bytes);
      expect(
        (
          await request(app(ids.student))
            .get(path.replace(ids.course, uuidv7()))
            .set("Cookie", "__Host-chalktalk_session=opaque")
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app(ids.outsider))
            .get(path)
            .set("Cookie", "__Host-chalktalk_session=opaque")
        ).status,
      ).toBe(404);
    });
  }
  it("replays the same key and rejects changed payload without an extra object", async () => {
    const key = randomBytes(12).toString("hex");
    const countBefore = (
      await pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM course_files WHERE course_id=$1",
        [ids.course],
      )
    ).rows[0]!.n;
    const first = await upload(
      ids.instructor,
      "image.png",
      "image/png",
      png,
      key,
    );
    const replay = await upload(
      ids.instructor,
      "image.png",
      "image/png",
      png,
      key,
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.location).toBe(first.headers.location);
    expect(
      (await upload(ids.instructor, "changed.png", "image/png", png, key))
        .status,
    ).toBe(409);
    expect(
      (
        await upload(
          ids.instructor,
          "image.png",
          "image/png",
          Buffer.from("forged bytes"),
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM course_files WHERE course_id=$1",
          [ids.course],
        )
      ).rows[0].n,
    ).toBe(countBefore + 1);
  });
  it("replays a prior upload after archival but rejects a new upload", async () => {
    const key = randomBytes(12).toString("hex");
    const first = await upload(
      ids.instructor,
      "image.png",
      "image/png",
      png,
      key,
    );
    expect(first.status).toBe(201);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      const replay = await upload(
        ids.instructor,
        "image.png",
        "image/png",
        png,
        key,
      );
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(replay.headers.location).toBe(first.headers.location);
      expect(
        (await upload(ids.instructor, "image.png", "image/png", png)).status,
      ).toBe(409);
      await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
        ids.course,
      ]);
      const staged = vi.spyOn(fs, "mkdtemp");
      try {
        expect(
          (await upload(ids.instructor, "image.png", "image/png", png, key))
            .status,
        ).toBe(409);
        expect(staged).not.toHaveBeenCalled();
        await expect(
          new CourseFileService(pool, s3, bucket).create(
            ids.course,
            ids.instructor,
            {
              fileName: "image.png",
              declaredType: "image/png",
              filePath: join(process.cwd(), "nonexistent-course-file-upload"),
              sizeBytes: png.length,
              cleanup: async () => {},
            },
            key,
          ),
        ).rejects.toMatchObject({ status: 409 });
      } finally {
        staged.mockRestore();
      }
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });
  it("rejects a replay if the course starts deleting before the locked check", async () => {
    const key = randomBytes(12).toString("hex");
    expect(
      (await upload(ids.instructor, "image.png", "image/png", png, key)).status,
    ).toBe(201);
    const racingPool = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query")
              return async (...args: unknown[]) => {
                if (
                  typeof args[0] === "string" &&
                  args[0].includes("FOR UPDATE OF c,m")
                )
                  await pool.query(
                    "UPDATE courses SET status='deleting' WHERE id=$1",
                    [ids.course],
                  );
                return (
                  target.query as (...values: unknown[]) => Promise<unknown>
                ).apply(target, args);
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Pool;
    try {
      await expect(
        createStaged(new CourseFileService(racingPool, s3, bucket), key),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });
  it("rejects unauthorized and new archived uploads before staging or hashing", async () => {
    const staged = vi.spyOn(fs, "mkdtemp");
    const path = `/api/v1/courses/${ids.course}/files`;
    const postUpload = (userId: string, key?: string) => {
      let call = request(app(userId))
        .post(path)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .attach("file", png, {
          filename: "image.png",
          contentType: "image/png",
        });
      if (key) call = call.set("Idempotency-Key", key);
      return call;
    };
    try {
      expect((await postUpload(ids.student)).status).toBe(403);
      expect((await postUpload(ids.outsider)).status).toBe(403);
      await expect(
        new CourseFileService(pool, s3, bucket).create(
          ids.course,
          ids.student,
          {
            fileName: "image.png",
            declaredType: "image/png",
            filePath: join(process.cwd(), "nonexistent-course-file-upload"),
            sizeBytes: png.length,
            cleanup: async () => {},
          },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        ids.course,
      ]);
      expect((await postUpload(ids.instructor)).status).toBe(409);
      expect(
        (await postUpload(ids.instructor, randomBytes(12).toString("hex")))
          .status,
      ).toBe(409);
      expect(staged).not.toHaveBeenCalled();
    } finally {
      staged.mockRestore();
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });
  it("rejects a new upload if the course is archived during storage", async () => {
    const rowsBefore = (
      await pool.query("SELECT count(*)::int AS n FROM course_files")
    ).rows[0].n;
    const objectsBefore =
      (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents
        ?.length ?? 0;
    const racingStore = {
      send: async (command: PutObjectCommand | DeleteObjectCommand) => {
        const response = await s3.send(command as never);
        if (command instanceof PutObjectCommand)
          await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
            ids.course,
          ]);
        return response;
      },
    } as unknown as S3Client;
    try {
      await expect(
        createStaged(new CourseFileService(pool, racingStore, bucket)),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await pool.query("SELECT count(*)::int AS n FROM course_files"))
          .rows[0].n,
      ).toBe(rowsBefore);
      expect(
        (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents
          ?.length ?? 0,
      ).toBe(objectsBefore);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });
  it("retains a committed object when COMMIT acknowledgment is lost", async () => {
    const rowsBefore = (
      await pool.query("SELECT count(*)::int AS n FROM course_files")
    ).rows[0].n;
    const ambiguousPool = {
      connect: async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query")
              return async (...args: unknown[]) => {
                if (args[0] === "COMMIT") {
                  await target.query("COMMIT");
                  throw new Error("commit acknowledgment lost");
                }
                return (
                  target.query as (...values: unknown[]) => Promise<unknown>
                ).apply(target, args);
              };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
      query: pool.query.bind(pool),
    } as unknown as Pool;
    await expect(
      createStaged(new CourseFileService(ambiguousPool, s3, bucket)),
    ).rejects.toMatchObject({ status: 503 });
    const persisted = await pool.query<{ id: string; object_key: string }>(
      "SELECT id,object_key FROM course_files ORDER BY created_at DESC LIMIT 1",
    );
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM course_files")).rows[0]
        .n,
    ).toBe(rowsBefore + 1);
    const key = persisted.rows[0]!.object_key;
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(objects.Contents?.some((object) => object.Key === key)).toBe(true);
    const downloaded = await request(app(ids.student))
      .get(
        `/api/v1/courses/${ids.course}/files/${persisted.rows[0]!.id}/download`,
      )
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .buffer(true)
      .parse(asBytes);
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toEqual(png);
  });
  it("rejects downloads after membership is revoked", async () => {
    const created = await upload(ids.instructor, "image.png", "image/png", png);
    expect(created.status).toBe(201);
    const path = created.headers.location;
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.student],
    );
    try {
      const denied = await request(app(ids.student))
        .get(path)
        .set("Cookie", "__Host-chalktalk_session=opaque");
      expect(denied.status).toBe(404);
    } finally {
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
        [ids.course, ids.student],
      );
    }
  });
  it("serializes concurrent retries and rejects changed bytes under the same key", async () => {
    const key = randomBytes(12).toString("hex");
    const before = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    const [first, second] = await Promise.all([
      upload(
        ids.instructor,
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docx,
        key,
      ),
      upload(
        ids.instructor,
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docx,
        key,
      ),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    const after = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect((after.Contents ?? []).length).toBe(
      (before.Contents ?? []).length + 1,
    );
    const changedBytes = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        "_rels/.rels": strToU8(
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        "word/document.xml": strToU8(
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Changed</w:t></w:r></w:p></w:body></w:document>',
        ),
      }),
    );
    expect(
      (
        await upload(
          ids.instructor,
          "notes.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          changedBytes,
          key,
        )
      ).status,
    ).toBe(409);
    expect(
      (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents
        ?.length,
    ).toBe((after.Contents ?? []).length);
  });
  it("rejects missing parts, mismatched MIME, unsupported formats and oversized bytes", async () => {
    const base = () =>
      request(app(ids.instructor))
        .post(`/api/v1/courses/${ids.course}/files`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf");
    expect(
      (
        await base().field(
          "metadata",
          JSON.stringify({ kind: "upload", title: "X", description: "" }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await base().field("metadata", "{}").attach("file", png, {
          filename: "image.png",
          contentType: "image/png",
        })
      ).status,
    ).toBe(422);
    expect(
      (await upload(ids.instructor, "image.png", "image/jpeg", png)).status,
    ).toBe(415);
    expect(
      (
        await upload(
          ids.instructor,
          "image.exe",
          "application/octet-stream",
          png,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(
          ids.instructor,
          "image.png",
          "image/png",
          Buffer.alloc(100 * 1024 * 1024 + 1, 1),
        )
      ).status,
    ).toBe(413);
  });
  it("rejects active Office package content and cleans a stored object when database commit fails", async () => {
    const macro = Buffer.from(
      zipSync({
        "[Content_Types].xml": strToU8(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
        "_rels/.rels": strToU8(
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        "word/document.xml": strToU8(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ),
        "word/vbaProject.bin": new Uint8Array([1, 2, 3]),
      }),
    );
    expect(
      (
        await upload(
          ids.instructor,
          "notes.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          macro,
        )
      ).status,
    ).toBe(415);
    const before =
      (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents
        ?.length ?? 0;
    await pool.query(
      "CREATE FUNCTION reject_course_file() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert failure'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER reject_course_file_insert BEFORE INSERT ON course_files FOR EACH ROW EXECUTE FUNCTION reject_course_file()",
    );
    try {
      expect(
        (await upload(ids.instructor, "image.png", "image/png", png)).status,
      ).toBe(503);
      expect(
        (await s3.send(new ListObjectsV2Command({ Bucket: bucket }))).Contents
          ?.length ?? 0,
      ).toBe(before);
    } finally {
      await pool.query(
        "DROP TRIGGER reject_course_file_insert ON course_files",
      );
      await pool.query("DROP FUNCTION reject_course_file()");
    }
  });
  it("enforces session, Origin, CSRF and archived-course rules before storing bytes", async () => {
    const path = `/api/v1/courses/${ids.course}/files`;
    const unauthenticated = await request(app(ids.instructor))
      .post(path)
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .attach("file", png, { filename: "image.png", contentType: "image/png" });
    expect(unauthenticated.status).toBe(401);
    const origin = await request(app(ids.instructor))
      .post(path)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", "https://evil.example.edu")
      .set("X-CSRF-Token", "csrf")
      .attach("file", png, { filename: "image.png", contentType: "image/png" });
    expect(origin.status).toBe(403);
    const csrf = await request(app(ids.instructor))
      .post(path)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .attach("file", png, { filename: "image.png", contentType: "image/png" });
    expect(csrf.status).toBe(403);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect(
        (await upload(ids.instructor, "image.png", "image/png", png)).status,
      ).toBe(409);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
  });
  it("rejects non-instructors and disguised or malformed files", async () => {
    expect(
      (await upload(ids.student, "image.png", "image/png", png)).status,
    ).toBe(403);
    expect(
      (
        await upload(
          ids.instructor,
          "image.png",
          "image/png",
          Buffer.from("<script>bad</script>"),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(
          ids.instructor,
          "slides.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          Buffer.from("not a zip"),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await upload(
          ids.instructor,
          "macro.docm",
          "application/vnd.ms-word.document.macroEnabled.12",
          docx,
        )
      ).status,
    ).toBe(415);
  });
  it("accepts a 100 MiB file streamed from disk", async () => {
    const directory = await fs.mkdtemp(
      join(tmpdir(), "chalktalk-upload-test-"),
    );
    const path = join(directory, "boundary.txt");
    try {
      const file = await fs.open(path, "w");
      const expectedHash = createHash("sha256");
      try {
        const block = Buffer.alloc(1024 * 1024, 0x61);
        for (let i = 0; i < 100; i++) {
          await file.write(block);
          expectedHash.update(block);
        }
      } finally {
        await file.close();
      }
      const response = await request(app(ids.instructor))
        .post(`/api/v1/courses/${ids.course}/files`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .attach("file", path, {
          filename: "boundary.txt",
          contentType: "text/plain",
        });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.data.sizeBytes).toBe(100 * 1024 * 1024);
      const downloaded = await request(app(ids.student))
        .get(response.headers.location)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .buffer(true)
        .parse(asDigest);
      expect(downloaded.status).toBe(200);
      expect(downloaded.body).toEqual({
        size: 100 * 1024 * 1024,
        sha256: expectedHash.digest("hex"),
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("removes staged files after successful and rejected uploads", async () => {
    const staged = async () =>
      (await fs.readdir(tmpdir())).filter((name) =>
        name.startsWith("chalktalk-upload-"),
      );
    await vi.waitFor(async () => expect(await staged()).toEqual([]));
    expect(
      (await upload(ids.instructor, "image.png", "image/png", png)).status,
    ).toBe(201);
    expect(
      (await upload(ids.instructor, "image.png", "image/jpeg", png)).status,
    ).toBe(415);
    await vi.waitFor(async () => expect(await staged()).toEqual([]));
  });
  it("hides a deleted file immediately and durably removes its bytes", async () => {
    const key = randomBytes(12).toString("hex");
    const created = await upload(
      ids.instructor,
      "image.png",
      "image/png",
      png,
      key,
    );
    expect(created.status).toBe(201);
    const fileId = created.body.data.id as string;
    const filePath = `/api/v1/courses/${ids.course}/files/${fileId}`;
    const deleted = await request(app(ids.instructor))
      .delete(filePath)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf");
    expect(deleted.status).toBe(204);
    expect(
      (
        await request(app(ids.instructor))
          .delete(filePath)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app(ids.student))
          .get(created.headers.location)
          .set("Cookie", "__Host-chalktalk_session=opaque")
      ).status,
    ).toBe(404);
    expect(
      (await upload(ids.instructor, "image.png", "image/png", png, key)).status,
    ).toBe(409);
    const file = await pool.query<{ object_key: string; deleted_at: Date }>(
      "SELECT object_key,deleted_at FROM course_files WHERE id=$1",
      [fileId],
    );
    expect(file.rows[0]?.deleted_at).toBeTruthy();
    const queued = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE kind='delete_course_file' AND deduplication_key=$1",
      [`file-delete:${fileId}`],
    );
    expect(queued.rows[0]?.status).toBe("queued");
    const worker = new JobWorker(
      pool,
      "course-file-test",
      undefined,
      undefined,
      {
        client: s3,
        bucket,
      },
    );
    expect(await worker.runOnce()).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT status FROM jobs WHERE kind='delete_course_file' AND deduplication_key=$1",
          [`file-delete:${fileId}`],
        )
      ).rows[0].status,
    ).toBe("succeeded");
    const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(
      (objects.Contents ?? []).some(
        (item) => item.Key === file.rows[0]?.object_key,
      ),
    ).toBe(false);
  });
  it("allows only the current original instructor to delete, and archives are download-only", async () => {
    const created = await upload(ids.instructor, "image.png", "image/png", png);
    expect(created.status).toBe(201);
    const filePath = `/api/v1/courses/${ids.course}/files/${created.body.data.id}`;
    const remove = (userId: string) =>
      request(app(userId))
        .delete(filePath)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf");
    expect((await remove(ids.otherInstructor)).status).toBe(403);
    expect((await remove(ids.ta)).status).toBe(403);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect((await remove(ids.instructor)).status).toBe(409);
      const downloaded = await request(app(ids.student))
        .get(created.headers.location)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .buffer(true)
        .parse(asBytes);
      expect(downloaded.status).toBe(200);
      expect(downloaded.body).toEqual(png);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect(
        (
          await request(app(ids.student))
            .get(created.headers.location)
            .set("Cookie", "__Host-chalktalk_session=opaque")
        ).status,
      ).toBe(404);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.instructor],
    );
    try {
      expect((await remove(ids.instructor)).status).toBe(403);
    } finally {
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'instructor')",
        [ids.course, ids.instructor],
      );
    }
  });
  it("rolls back a delete when durable cleanup cannot be queued", async () => {
    const created = await upload(ids.instructor, "image.png", "image/png", png);
    expect(created.status).toBe(201);
    const fileId = created.body.data.id as string;
    await pool.query(`
      CREATE FUNCTION reject_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.kind='delete_course_file' THEN RAISE EXCEPTION 'cleanup queue unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_file_cleanup BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION reject_file_cleanup();
    `);
    try {
      const response = await request(app(ids.instructor))
        .delete(`/api/v1/courses/${ids.course}/files/${fileId}`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf");
      expect(response.status).toBe(500);
      expect(
        (
          await pool.query("SELECT deleted_at FROM course_files WHERE id=$1", [
            fileId,
          ])
        ).rows[0].deleted_at,
      ).toBeNull();
      const downloaded = await request(app(ids.student))
        .get(created.headers.location)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .buffer(true)
        .parse(asBytes);
      expect(downloaded.status).toBe(200);
      expect(downloaded.body).toEqual(png);
    } finally {
      await pool.query("DROP TRIGGER reject_file_cleanup ON jobs");
      await pool.query("DROP FUNCTION reject_file_cleanup()");
    }
  });
  it("enforces byte-size and checksum constraints in PostgreSQL", async () => {
    const base = [
      uuidv7(),
      ids.course,
      `courses/${ids.course}/files/${uuidv7()}`,
      "text/plain",
      "bad.txt",
    ];
    await expect(
      pool.query(
        "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,$5,0,$6)",
        [...base, Buffer.alloc(32)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO course_files (id,course_id,object_key,media_type,file_name,size_bytes,checksum_sha256) VALUES ($1,$2,$3,$4,$5,1,$6)",
        [...base, Buffer.alloc(1)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
