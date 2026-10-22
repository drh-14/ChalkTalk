import { JobWorker } from "../jobs/worker.js";
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { CourseFileService } from "../course-files/service.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { loadEnvironment } from "../config/environment.js";
import type { AuthService } from "../auth/service.js";
import { CourseInformationService } from "../course-information/service.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const schema = `course_information_${process.pid}_${Date.now()}`;
const org = randomUUID(),
  course = randomUUID(),
  instructor = randomUUID(),
  student = randomUUID(),
  ta = randomUUID(),
  outsider = randomUUID();
let admin: Pool, pool: Pool;
const s3Endpoint = process.env.TEST_S3_ENDPOINT;
const bucket = `course-info-${process.pid}-${Date.now()}`;
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

const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
function app(userId?: string) {
  return createApp({
    environment,
    authService: {
      session: async () => ({
        id: randomUUID(),
        user: {
          id: userId,
          email: "x@example.edu",
          displayName: "X",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        },
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    } as AuthService,
    courseFileService: new CourseFileService(pool, s3, bucket),
    courseInformationService: new CourseInformationService(pool),
  });
}
const path = `/api/v1/courses/${course}/information`;
function read(userId = student, target = path) {
  return request(app(userId))
    .get(target)
    .set("Cookie", "__Host-chalktalk_session=opaque");
}
function patch(userId: string, body: unknown, etag?: string, target = path) {
  let r = request(app(userId))
    .patch(target)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
  if (etag) r = r.set("If-Match", etag);
  return r.send(body);
}
suite("course information contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    if (s3Endpoint) await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'info.example.edu','Example')",
      [org],
    );
    for (const [id, name] of [
      [instructor, "Ada"],
      [student, "Bob"],
      [ta, "Charlie"],
      [outsider, "Dana"],
    ])
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,'x')",
        [id, org, `${id}@example.edu`, name],
      );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Calculus','ABCDEFGH')",
      [course, org, instructor],
    );
    for (const [id, role] of [
      [instructor, "instructor"],
      [student, "student"],
      [ta, "ta"],
    ])
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,$3)",
        [course, id, role],
      );
  });
  afterAll(async () => {
    if (s3Endpoint) {
      for (const o of (
        await s3.send(new ListObjectsV2Command({ Bucket: bucket }))
      ).Contents ?? [])
        if (o.Key)
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: o.Key }),
          );
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    s3.destroy();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  it("reads an empty model without creating persisted information", async () => {
    const r = await read();
    expect(r.status).toBe(200);
    expect(r.headers.etag).toBe('"v1"');
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.body.data).toMatchObject({
      courseId: course,
      descriptionMarkdown: "",
      website: null,
      syllabus: null,
      version: 1,
    });
    expect(
      (await pool.query("SELECT * FROM course_information")).rows,
    ).toHaveLength(0);
  });
  it("requires authentication and current membership in the actual course", async () => {
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await read(outsider)).status).toBe(404);
  });
  it("conditionally saves instructor information and rejects stale and missing versions", async () => {
    const body = {
      descriptionMarkdown: "## Welcome\nRead **carefully**.",
      website: "https://example.edu/course",
    };
    expect((await patch(instructor, body)).status).toBe(428);
    const r = await patch(instructor, body, '"v1"');
    expect(r.status).toBe(200);
    expect(r.headers.etag).toBe('"v2"');
    expect(r.body.data.descriptionMarkdown).toBe(body.descriptionMarkdown);
    expect(
      (
        await patch(
          instructor,
          { ...body, descriptionMarkdown: "stale" },
          '"v1"',
        )
      ).status,
    ).toBe(412);
    expect((await read()).body.data.descriptionMarkdown).toBe(
      body.descriptionMarkdown,
    );
  });
  it("rejects student and TA mutations, unsafe origins, unknown fields and unsafe websites", async () => {
    for (const id of [student, ta, outsider])
      expect(
        (await patch(id, { descriptionMarkdown: "x", website: null }, '"v2"'))
          .status,
      ).toBe(403);
    expect(
      (
        await request(app(instructor))
          .patch(path)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .send({ descriptionMarkdown: "x" })
      ).status,
    ).toBe(403);
    for (const website of [
      "javascript:alert(1)",
      "https://user:pass@example.edu",
      "https://example.edu/ white",
      "https://example.edu/\u2003x",
    ])
      expect(
        (await patch(instructor, { descriptionMarkdown: "x", website }, '"v2"'))
          .status,
      ).toBe(422);
    expect(
      (
        await patch(
          instructor,
          { descriptionMarkdown: "x", role: "instructor" },
          '"v2"',
        )
      ).status,
    ).toBe(422);
  });
  it("lists only current staff and conditionally edits their descriptive profile", async () => {
    const target = `/api/v1/courses/${course}/staff`;
    const empty = await read(student, target);
    expect(empty.status).toBe(200);
    expect(
      empty.body.data.map((r: { displayName: string }) => r.displayName),
    ).toEqual(["Ada", "Charlie"]);
    expect(empty.body.data[0]).not.toHaveProperty("email");
    const endpoint = `${target}/${ta}`;
    expect(
      (
        await patch(
          ta,
          {
            contact: "c@example.edu",
            location: "Room 10",
            officeHours: "Tuesday 2–3",
          },
          '"v1"',
          endpoint,
        )
      ).status,
    ).toBe(403);
    const changed = await patch(
      instructor,
      {
        contact: "c@example.edu",
        location: "Room 10",
        officeHours: "Tuesday 2–3",
      },
      '"v1"',
      endpoint,
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).toBe('"v2"');
    expect(
      (
        await patch(
          instructor,
          { contact: "stale", location: "", officeHours: "" },
          '"v1"',
          endpoint,
        )
      ).status,
    ).toBe(412);
    expect(
      (await read(student, target)).body.data.find(
        (r: { userId: string }) => r.userId === ta,
      ),
    ).toMatchObject({
      officeHours: "Tuesday 2–3",
      role: "ta",
      displayName: "Charlie",
    });
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [course, ta],
    );
    expect(
      (await read(student, target)).body.data.map(
        (r: { userId: string }) => r.userId,
      ),
    ).not.toContain(ta);
    expect(
      (
        await patch(
          instructor,
          { contact: "x", location: "", officeHours: "" },
          '"v2"',
          endpoint,
        )
      ).status,
    ).toBe(404);
    await pool.query(
      "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
      [course, ta],
    );
  });
  it("keeps archived information readable but rejects information and staff mutations", async () => {
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      course,
    ]);
    expect((await read()).status).toBe(200);
    expect(
      (
        await patch(
          instructor,
          { descriptionMarkdown: "x", website: null },
          '"v2"',
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await patch(
          instructor,
          { contact: "", location: "", officeHours: "" },
          '"v1"',
          `/api/v1/courses/${course}/staff/${instructor}`,
        )
      ).status,
    ).toBe(409);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      course,
    ]);
  });

  it.skipIf(!s3Endpoint)(
    "atomically replaces a syllabus, preserves it on invalid or stale uploads, guards standalone deletion and queues removed bytes",
    async () => {
      const target = `${path}/syllabus`;
      const upload = (
        version: string,
        name = "syllabus.txt",
        content = "Course syllabus",
      ) =>
        request(app(instructor))
          .put(target)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("If-Match", version)
          .attach("file", Buffer.from(content), {
            filename: name,
            contentType: "text/plain",
          });
      const first = await upload('"v2"');
      expect(first.status).toBe(200);
      expect(first.body.data.syllabus.fileName).toBe("syllabus.txt");
      expect(first.headers.etag).toBe('"v3"');
      const file = first.body.data.syllabus;
      expect(
        (
          await request(app(instructor))
            .delete(`/api/v1/courses/${course}/files/${file.id}`)
            .set("Cookie", "__Host-chalktalk_session=opaque")
            .set("Origin", environment.frontendBaseUrl)
            .set("X-CSRF-Token", "csrf")
        ).status,
      ).toBe(409);
      expect(
        (await upload('"v3"', "syllabus.png", "not an image")).status,
      ).toBe(415);
      expect((await upload('"v2"')).status).toBe(412);
      expect((await read()).body.data.syllabus.id).toBe(file.id);
      expect(
        (
          await read(
            student,
            `/api/v1/courses/${course}/files/${file.id}/download`,
          )
        ).text,
      ).toBe("Course syllabus");
      expect(
        (
          await read(
            outsider,
            `/api/v1/courses/${course}/files/${file.id}/download`,
          )
        ).status,
      ).toBe(404);
      const second = await upload(
        '"v3"',
        "replacement.txt",
        "Updated syllabus",
      );
      expect(second.status).toBe(200);
      expect(second.body.data.syllabus.id).not.toBe(file.id);
      expect(
        (
          await read(
            student,
            `/api/v1/courses/${course}/files/${file.id}/download`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await pool.query(
            "SELECT * FROM jobs WHERE kind='delete_course_file' AND payload->>'fileId'=$1",
            [file.id],
          )
        ).rowCount,
      ).toBe(1);
      const removed = await request(app(instructor))
        .delete(target)
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .set("If-Match", '"v4"');
      expect(removed.status).toBe(200);
      expect(removed.body.data.syllabus).toBeNull();
      expect(removed.headers.etag).toBe('"v5"');
    },
  );

  it("does not authorize an instructor from a different course and hides removed/deleted memberships", async () => {
    const other = randomUUID();
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Other course','ZZZZZZZZ')",
      [other, org, outsider],
    );
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'instructor')",
      [other, outsider],
    );
    expect((await read(outsider)).status).toBe(404);
    expect(
      (await read(outsider, `/api/v1/courses/${course}/staff`)).status,
    ).toBe(404);
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [course, student],
    );
    expect((await read(student)).status).toBe(404);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
      [course, student],
    );
    await pool.query(
      "UPDATE users SET deleted_at=clock_timestamp() WHERE id=$1",
      [ta],
    );
    expect((await read(ta)).status).toBe(404);
    expect(
      (await read(student, `/api/v1/courses/${course}/staff`)).body.data.map(
        (r: { userId: string }) => r.userId,
      ),
    ).not.toContain(ta);
    await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [ta]);
  });
  it("enforces text bounds and rejects unknown staff fields", async () => {
    const version = (await read()).headers.etag;
    expect(
      (
        await patch(
          instructor,
          { descriptionMarkdown: "x".repeat(50001), website: null },
          version,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await patch(
          instructor,
          { descriptionMarkdown: "😀".repeat(25001), website: null },
          version,
        )
      ).status,
    ).toBe(200);
    const target = `/api/v1/courses/${course}/staff/${instructor}`;
    expect(
      (
        await patch(
          instructor,
          { contact: "x".repeat(2001), location: "", officeHours: "" },
          '"v1"',
          target,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await patch(
          instructor,
          { contact: "", location: "", officeHours: "", role: "ta" },
          '"v1"',
          target,
        )
      ).status,
    ).toBe(422);
  });
  it.skipIf(!s3Endpoint)(
    "preserves the syllabus when storage is unavailable and serializes final attachment against archival",
    async () => {
      let etag = (await read()).headers.etag;
      const target = `${path}/syllabus`;
      const upload = () =>
        request(app(instructor))
          .put(target)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("If-Match", etag)
          .attach("file", Buffer.from("Syllabus"), {
            filename: "syllabus.txt",
            contentType: "text/plain",
          });
      const first = await upload();
      expect(first.status).toBe(200);
      etag = first.headers.etag;
      const id = first.body.data.syllabus.id;
      const failure = vi
        .spyOn(s3, "send")
        .mockRejectedValueOnce(new Error("storage offline"));
      expect((await upload()).status).toBe(503);
      failure.mockRestore();
      expect((await read()).body.data.syllabus.id).toBe(id);
      let started!: () => void, release!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = s3.send.bind(s3);
      const spy = vi
        .spyOn(s3, "send")
        .mockImplementationOnce(async (command) => {
          if (command instanceof PutObjectCommand) {
            started();
            await wait;
          }
          return original(command);
        });
      const pending = upload().then((r) => r);
      await start;
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      release();
      expect((await pending).status).toBe(409);
      spy.mockRestore();
      expect((await read()).body.data.syllabus.id).toBe(id);
      expect(
        (await read(student, `/api/v1/courses/${course}/files/${id}/download`))
          .status,
      ).toBe(200);
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        course,
      ]);
    },
  );
  it("serializes concurrent information saves without dropping either writer silently", async () => {
    const etag = (await read()).headers.etag;
    const results = await Promise.all([
      patch(
        instructor,
        { descriptionMarkdown: "First writer", website: null },
        etag,
      ),
      patch(
        instructor,
        { descriptionMarkdown: "Second writer", website: null },
        etag,
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
    expect(["First writer", "Second writer"]).toContain(
      (await read()).body.data.descriptionMarkdown,
    );
  });
  it.skipIf(!s3Endpoint)(
    "the separate worker physically cleans replaced syllabus bytes without removing the current syllabus",
    async () => {
      const current = (await read()).body.data.syllabus;
      const queued = await pool.query<{ object_key: string }>(
        "SELECT object_key FROM course_files WHERE course_id=$1 AND deleted_at IS NOT NULL",
        [course],
      );
      expect(queued.rows.length).toBeGreaterThan(0);
      const worker = new JobWorker(
        pool,
        "course-information-cleanup",
        undefined,
        undefined,
        { client: s3, bucket },
      );
      for (let i = 0; i < 10 && (await worker.runOnce()); i++);
      for (const row of queued.rows)
        await expect(
          s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: row.object_key }),
          ),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect(
        (
          await read(
            student,
            `/api/v1/courses/${course}/files/${current.id}/download`,
          )
        ).status,
      ).toBe(200);
    },
  );
});
