import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { CourseFileService } from "../course-files/service.js";
import { CourseResourceService } from "../course-resources/service.js";
import { CourseService } from "../courses/service.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { JobWorker } from "../jobs/worker.js";
import { missingExtractionTools } from "../resource-text/probe.js";
import { createApp } from "./app.js";

// End to end with the real toolchain: HTTP upload, worker OCR, member search.
const url = process.env.TEST_DATABASE_URL,
  endpoint = process.env.TEST_S3_ENDPOINT,
  tools =
    spawnSync("qpdf", ["--version"]).error === undefined &&
    (await missingExtractionTools("eng")).length === 0,
  suite = url && endpoint && tools ? describe : describe.skip,
  bucket = `ocr-e2e-${process.pid}-${Date.now()}`,
  schema = `ocr_e2e_${process.pid}_${Date.now()}`,
  s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "chalktalk-local",
      secretAccessKey: "chalktalk-local-secret",
    },
  });
const org = randomUUID(),
  course = randomUUID(),
  instructor = randomUUID(),
  student = randomUUID();
let pool: Pool, admin: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
const app = (userId: string) =>
  createApp({
    environment,
    authService: {
      session: async () => ({
        id: randomUUID(),
        user: {
          id: userId,
          email: "x@example.edu",
          displayName: "X",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    } as AuthService,
    courseService: new CourseService(pool),
    courseFileService: new CourseFileService(pool, s3, bucket),
    courseResourceService: new CourseResourceService(pool),
  });
const fixture = (name: string) =>
  readFile(
    fileURLToPath(
      new URL(`../resource-text/fixtures/${name}`, import.meta.url),
    ),
  );

if (!tools)
  console.warn(
    "Skipping OCR end-to-end test: qpdf, Poppler and Tesseract (eng) are required.",
  );

suite("resource OCR end to end", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}",public`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'ocr.example.edu','Example')",
      [org],
    );
    for (const id of [instructor, student])
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'User','x')",
        [id, org, `${id}@example.edu`],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Optimization','OCRE2ETS')",
      [course, org, instructor],
    );
    for (const [id, role] of [
      [instructor, "instructor"],
      [student, "student"],
    ])
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,$3)",
        [course, id, role],
      );
  });
  afterAll(async () => {
    for (const object of (
      await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
    ).Contents ?? [])
      if (object.Key)
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    s3.destroy();
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  it("makes uploaded text PDFs, scanned PDFs and PNG photos searchable by their contents", async () => {
    const uploads = [
      {
        title: "Lecture notes",
        name: "lecture.pdf",
        type: "application/pdf",
        bytes: await fixture("text.pdf"),
        word: "diagonalization",
      },
      {
        title: "Scanned worksheet",
        name: "worksheet.pdf",
        type: "application/pdf",
        bytes: await fixture("scanned.pdf"),
        word: "gradient",
      },
      {
        title: "Handout photo",
        name: "handout.png",
        type: "image/png",
        bytes: await sharp(await fixture("photo.webp"))
          .png()
          .toBuffer(),
        word: "determinant",
      },
    ];
    for (const upload of uploads) {
      const created = await request(app(instructor))
        .post(`/api/v1/courses/${course}/resources/files`)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .field("title", upload.title)
        .attach("file", upload.bytes, {
          filename: upload.name,
          contentType: upload.type,
        });
      expect(created.status, upload.name).toBe(201);
      expect(created.body.data.textStatus).toBe("pending");
    }

    const worker = new JobWorker(
      pool,
      "ocr-e2e",
      undefined,
      undefined,
      { client: s3, bucket },
      undefined,
      undefined,
      { maxOcrPages: 200, ocrLanguages: "eng" },
    );
    while (await worker.runOnce("extraction"));

    const catalog = await request(app(student))
      .get(`/api/v1/courses/${course}/resources`)
      .set("Cookie", "__Host-chalktalk_session=opaque");
    expect(
      catalog.body.data.map(
        (entry: { textStatus: string }) => entry.textStatus,
      ),
    ).toEqual(["ready", "ready", "ready"]);

    for (const upload of uploads) {
      const found = await request(app(student))
        .get(`/api/v1/courses/${course}/resources/search`)
        .query({ q: upload.word })
        .set("Cookie", "__Host-chalktalk_session=opaque");
      expect(found.status).toBe(200);
      expect(
        found.body.data.map(
          (item: { resource: { title: string } }) => item.resource.title,
        ),
        upload.word,
      ).toEqual([upload.title]);
      const { text, highlights } = found.body.data[0].match.snippet;
      expect(
        highlights
          .map((range: { start: number; length: number }) =>
            text.slice(range.start, range.start + range.length),
          )
          .join(" ")
          .toLowerCase(),
      ).toContain(upload.word);
    }
  }, 120_000);
});
