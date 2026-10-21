import { CourseService } from "../courses/service.js";
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
import type { AuthService } from "../auth/service.js";
import { CourseResourceService } from "../course-resources/service.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { loadEnvironment } from "../config/environment.js";
const endpoint = process.env.TEST_S3_ENDPOINT,
  bucket = `organized-${process.pid}-${Date.now()}`,
  s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "chalktalk-local",
      secretAccessKey: "chalktalk-local-secret",
    },
  });
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const schema = `organized_resources_${process.pid}_${Date.now()}`,
  org = randomUUID(),
  course = randomUUID(),
  instructor = randomUUID(),
  student = randomUUID(),
  ta = randomUUID(),
  outsider = randomUUID();
let pool: Pool, admin: Pool;
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
function app(userId: string) {
  return createApp({
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
}
const base = `/api/v1/courses/${course}`;
const get = (target: string, user = student) =>
  request(app(user))
    .get(base + target)
    .set("Cookie", "__Host-chalktalk_session=opaque");
function write(
  method: "post" | "patch" | "put" | "delete",
  target: string,
  body: unknown = {},
  etag?: string,
  user = instructor,
) {
  const agent = request(app(user));
  let r = agent[method](base + target)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
  if (etag) r = r.set("If-Match", etag);
  return r.send(body);
}
suite("organized resource catalog", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    if (endpoint) await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'resources.example.edu','Example')",
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
    if (endpoint) {
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
  it("starts with zero sections and allows only same-course instructors to create them", async () => {
    const empty = await get("/resource-sections");
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    for (const user of [student, ta, outsider])
      expect(
        (
          await write(
            "post",
            "/resource-sections",
            { title: "Readings", visibility: "class" },
            undefined,
            user,
          )
        ).status,
      ).toBe(403);
    const created = await write("post", "/resource-sections", {
      title: "Readings",
      visibility: "class",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      courseId: course,
      title: "Readings",
      visibility: "class",
      version: 1,
    });
    expect(created.headers.etag).toBe('"v1"');
  });
  it("rejects malformed section references before database UUID conversion", async () => {
    const sectionId = "------------------------------------";
    const created = await write("post", "/resources", {
      kind: "link",
      title: "Section validation",
      url: "https://example.edu/validation",
    });
    expect(created.status).toBe(201);
    for (const response of [
      await write("post", "/resources", {
        kind: "link",
        title: "Invalid section",
        url: "https://example.edu/invalid",
        sectionId,
      }),
      await write(
        "patch",
        `/resources/${created.body.data.id}`,
        { sectionId },
        created.headers.etag,
      ),
      await write(
        "put",
        "/resources/order",
        { ids: [], sectionId },
        (await get("/resources", instructor)).headers.etag,
      ),
    ]) {
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("validation_failed");
    }
    expect(
      (await get(`/resources/${created.body.data.id}`, instructor)).body.data
        .sectionId,
    ).toBeNull();
    expect(
      (
        await write(
          "delete",
          `/resources/${created.body.data.id}`,
          {},
          created.headers.etag,
        )
      ).status,
    ).toBe(204);
  });
  it.skipIf(!endpoint)(
    "rejects malformed file section references on create and replacement",
    async () => {
      const sectionId = "------------------------------------";
      const existing = await write("post", "/resources", {
        kind: "link",
        title: "Unchanged association",
        url: "https://example.edu/unchanged",
      });
      expect(existing.status).toBe(201);
      for (const [method, path, etag] of [
        ["post", "/resources/files", undefined],
        [
          "put",
          `/resources/${existing.body.data.id}/file`,
          existing.headers.etag,
        ],
      ] as const) {
        const client = request(app(instructor));
        let req = client[method](base + path)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("Idempotency-Key", randomUUID());
        if (etag) req = req.set("If-Match", etag);
        const response = await req
          .field("sectionId", sectionId)
          .attach("file", Buffer.from("valid text"), {
            filename: "valid.txt",
            contentType: "text/plain",
          });
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("validation_failed");
      }
      expect(
        (await get(`/resources/${existing.body.data.id}`, instructor)).body
          .data,
      ).toMatchObject({
        kind: "link",
        sectionId: null,
        version: 1,
      });
      expect(
        (
          await write(
            "delete",
            `/resources/${existing.body.data.id}`,
            {},
            existing.headers.etag,
          )
        ).status,
      ).toBe(204);
    },
  );
  it("filters staff-only sections and item restrictions before paging", async () => {
    const section = await write("post", "/resource-sections", {
      title: "Staff materials",
      visibility: "staff",
    });
    expect(section.status).toBe(201);
    const privateItem = await write("post", "/resources", {
      kind: "link",
      title: "Staff marking guide",
      url: "https://example.edu/marking",
      sectionId: section.body.data.id,
      visibility: "class",
    });
    expect(privateItem.status).toBe(201);
    const publicItem = await write("post", "/resources", {
      kind: "link",
      title: "Course website",
      url: "https://example.edu/course",
      visibility: "class",
    });
    expect(publicItem.status).toBe(201);
    expect(
      (await get("/resource-sections")).body.data.map(
        (s: { title: string }) => s.title,
      ),
    ).not.toContain("Staff materials");
    expect(
      (await get("/resource-sections", ta)).body.data.map(
        (s: { title: string }) => s.title,
      ),
    ).toContain("Staff materials");
    const listed = await get("/resources?limit=1");
    expect(listed.body.data.map((r: { title: string }) => r.title)).toEqual([
      "Course website",
    ]);
    expect(listed.body.page.hasMore).toBe(false);
    expect((await get(`/resources/${privateItem.body.data.id}`)).status).toBe(
      404,
    );
    expect(
      (await get(`/resources/${privateItem.body.data.id}`, ta)).status,
    ).toBe(200);
    expect((await get("/resources", outsider)).status).toBe(404);
  });
  it("conditionally edits sections and preserves staff-only access when a section is removed", async () => {
    const sections = (await get("/resource-sections", instructor)).body.data;
    const section = sections.find(
      (r: { title: string }) => r.title === "Staff materials",
    );
    expect(
      (
        await write("patch", `/resource-sections/${section.id}`, {
          title: "Marking",
        })
      ).status,
    ).toBe(428);
    const changed = await write(
      "patch",
      `/resource-sections/${section.id}`,
      { title: "Marking" },
      '"v1"',
    );
    expect(changed.status).toBe(200);
    expect(changed.body.data.version).toBe(2);
    expect(
      (
        await write(
          "patch",
          `/resource-sections/${section.id}`,
          { title: "Stale" },
          '"v1"',
        )
      ).status,
    ).toBe(412);
    expect(
      (await write("delete", `/resource-sections/${section.id}`, {}, '"v2"'))
        .status,
    ).toBe(204);
    const staff = (await get("/resources", ta)).body.data.find(
      (r: { title: string }) => r.title === "Staff marking guide",
    );
    expect(staff).toMatchObject({ sectionId: null, visibility: "staff" });
    expect((await get(`/resources/${staff.id}`)).status).toBe(404);
  });
  it("renames and moves resources conditionally and rejects stale collection cursors", async () => {
    const resource = (await get("/resources", instructor)).body.data.find(
      (r: { title: string }) => r.title === "Course website",
    );
    const section = (await get("/resource-sections")).body.data[0];
    const page = await get("/resources?limit=1", instructor);
    expect(page.body.page.hasMore).toBe(true);
    const changed = await write(
      "patch",
      `/resources/${resource.id}`,
      { title: "Official website", sectionId: section.id },
      `"v${resource.version}"`,
    );
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      id: resource.id,
      title: "Official website",
      sectionId: section.id,
    });
    expect(
      (
        await write(
          "patch",
          `/resources/${resource.id}`,
          { title: "Stale" },
          `"v${resource.version}"`,
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await get(
          "/resources?limit=1&cursor=" +
            encodeURIComponent(page.body.page.nextCursor),
          instructor,
        )
      ).status,
    ).toBe(400);
    const current = changed.body.data;
    expect(
      (
        await write(
          "delete",
          `/resources/${current.id}`,
          {},
          `"v${current.version}"`,
        )
      ).status,
    ).toBe(204);
    expect((await get(`/resources/${current.id}`, instructor)).status).toBe(
      404,
    );
  });

  it("rejects a staff cursor after demotion and starts a fresh student listing", async () => {
    const section = await write("post", "/resource-sections", {
      title: "Access-change pagination",
      visibility: "class",
    });
    expect(section.status).toBe(201);
    const sectionId = section.body.data.id;
    for (const [title, visibility] of [
      ["Staff first", "staff"],
      ["Public first", "class"],
      ["Public second", "class"],
    ]) {
      const created = await write("post", "/resources", {
        kind: "link",
        title,
        url: "https://example.edu/resource",
        sectionId,
        visibility,
      });
      expect(created.status).toBe(201);
    }
    const path = `/resources?sectionId=${sectionId}&limit=1`;
    const staffPage = await get(path, ta);
    expect(staffPage.status).toBe(200);
    expect(staffPage.body.data.map((r: { title: string }) => r.title)).toEqual([
      "Staff first",
    ]);
    expect(staffPage.body.page.hasMore).toBe(true);
    await pool.query(
      "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
      [course, ta],
    );
    try {
      const stale = await get(
        `${path}&cursor=${encodeURIComponent(staffPage.body.page.nextCursor)}`,
        ta,
      );
      expect(stale.status).toBe(400);
      expect(stale.body.error.code).toBe("invalid_request");
      const first = await get(path, ta);
      expect(first.status).toBe(200);
      expect(first.body.data.map((r: { title: string }) => r.title)).toEqual([
        "Public first",
      ]);
      expect(first.body.page.hasMore).toBe(true);
      const second = await get(
        `${path}&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
        ta,
      );
      expect(second.status).toBe(200);
      expect(second.body.data.map((r: { title: string }) => r.title)).toEqual([
        "Public second",
      ]);
      expect(second.body.page.hasMore).toBe(false);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [course, ta],
      );
    }
  });

  it("replays an authorized link create after archival and binds changed visibility to idempotency", async () => {
    const create = (access = "class") =>
      request(app(instructor))
        .post(base + "/resources")
        .set("Cookie", "__Host-chalktalk_session=opaque")
        .set("Origin", environment.frontendBaseUrl)
        .set("X-CSRF-Token", "csrf")
        .set("Idempotency-Key", "archived-link")
        .send({
          kind: "link",
          title: "Replay",
          url: "https://example.edu/replay",
          visibility: access,
        });
    const first = await create();
    expect(first.status).toBe(201);
    expect((await create("staff")).status).toBe(409);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      course,
    ]);
    const replay = await create();
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect((await create("staff")).status).toBe(409);
    expect(
      (
        await write("post", "/resources", {
          kind: "link",
          title: "Fresh archived link",
          url: "https://example.edu/fresh",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await write("post", "/resource-sections", {
          title: "No",
          visibility: "class",
        })
      ).status,
    ).toBe(409);
    await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
      course,
    ]);
  });

  it.skipIf(!endpoint)(
    "creates private catalog files atomically, guards legacy URLs and replaces immutable bytes with stable identity",
    async () => {
      const section = await write("post", "/resource-sections", {
        title: "Staff files",
        visibility: "staff",
      });
      const upload = (id?: string, etag?: string, key = "catalog-file") => {
        const agent = request(app(instructor));
        let r = agent[id ? "put" : "post"](
          base + (id ? `/resources/${id}/file` : "/resources/files"),
        )
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("Idempotency-Key", key);
        if (etag) r = r.set("If-Match", etag);
        return r
          .field("title", "Staff syllabus")
          .field("sectionId", section.body.data.id)
          .field("visibility", "class")
          .attach("file", Buffer.from("Staff-only contents"), {
            filename: "staff.txt",
            contentType: "text/plain",
          });
      };
      const first = await upload();
      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({
        title: "Staff syllabus",
        kind: "upload",
        sectionId: section.body.data.id,
      });
      expect((await upload()).body).toEqual(first.body);
      const resource = first.body.data,
        fileUrl = `/files/${resource.fileId}/download`;
      expect((await get(fileUrl)).status).toBe(404);
      expect((await get(fileUrl, ta)).text).toBe("Staff-only contents");
      expect(
        (await get("/files")).body.data.map((f: { id: string }) => f.id),
      ).not.toContain(resource.fileId);
      expect((await write("delete", `/files/${resource.fileId}`)).status).toBe(
        409,
      );
      const replaced = await upload(
        resource.id,
        `"v${resource.version}"`,
        "replacement",
      );
      expect(replaced.status).toBe(200);
      expect(replaced.body.data.id).toBe(resource.id);
      expect(replaced.body.data.fileId).not.toBe(resource.fileId);
      expect((await get(fileUrl, instructor)).status).toBe(404);
      expect(
        (
          await pool.query(
            "SELECT * FROM jobs WHERE kind='delete_course_file' AND payload->>'fileId'=$1",
            [resource.fileId],
          )
        ).rowCount,
      ).toBe(1);
    },
  );
  it.skipIf(!endpoint)(
    "preserves omitted replacement metadata and applies only explicit changes",
    async () => {
      const section = await write("post", "/resource-sections", {
        title: "Private replacement section",
        visibility: "staff",
      });
      expect(section.status).toBe(201);
      const resourceId = section.body.data.id;
      const sendFile = (
        id: string | undefined,
        etag: string | undefined,
        fields: Record<string, string>,
        key: string,
      ) => {
        const agent = request(app(instructor));
        let call = agent[id ? "put" : "post"](
          base + (id ? `/resources/${id}/file` : "/resources/files"),
        )
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("Idempotency-Key", key);
        if (etag) call = call.set("If-Match", etag);
        for (const [name, value] of Object.entries(fields))
          call = call.field(name, value);
        return call.attach("file", Buffer.from(key), {
          filename: `${key}.txt`,
          contentType: "text/plain",
        });
      };
      const created = await sendFile(
        undefined,
        undefined,
        {
          title: "Private title",
          sectionId: resourceId,
          visibility: "staff",
        },
        "private-original",
      );
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      const replacement = await sendFile(id, '"v1"', {}, "private-file-only");
      expect(replacement.status).toBe(200);
      expect(replacement.body.data).toMatchObject({
        id,
        title: "Private title",
        sectionId: resourceId,
        visibility: "staff",
      });
      expect(replacement.body.data.fileId).not.toBe(created.body.data.fileId);
      expect((await get(`/resources/${id}`)).status).toBe(404);
      expect(
        (await get(`/files/${replacement.body.data.fileId}/download`)).status,
      ).toBe(404);
      expect(
        (await get(`/files/${replacement.body.data.fileId}/download`, ta))
          .status,
      ).toBe(200);
      expect(
        (await get(`/files/${created.body.data.fileId}/download`, ta)).status,
      ).toBe(404);
      const release = { title: "Renamed title", visibility: "class" };
      expect(
        (await sendFile(id, '"v1"', release, "stale-release")).status,
      ).toBe(412);
      expect(
        (await get(`/resources/${id}`, instructor)).body.data,
      ).toMatchObject(replacement.body.data);
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      try {
        expect(
          (await sendFile(id, '"v2"', release, "archived-release")).status,
        ).toBe(409);
        expect(
          (await get(`/resources/${id}`, instructor)).body.data,
        ).toMatchObject(replacement.body.data);
      } finally {
        await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
          course,
        ]);
      }
      const narrowed = await sendFile(
        id,
        '"v2"',
        release,
        "explicit-visibility",
      );
      expect(narrowed.status).toBe(200);
      expect(narrowed.body.data).toMatchObject({
        title: "Renamed title",
        sectionId: resourceId,
        visibility: "class",
      });
      expect((await get(`/resources/${id}`)).status).toBe(404);
      expect(
        (await get(`/files/${narrowed.body.data.fileId}/download`)).status,
      ).toBe(404);
      const moved = await sendFile(
        id,
        '"v3"',
        { sectionId: "" },
        "explicit-move",
      );
      expect(moved.status).toBe(200);
      expect(moved.body.data).toMatchObject({
        title: "Renamed title",
        sectionId: null,
        visibility: "class",
      });
      expect((await get(`/resources/${id}`)).status).toBe(200);
      expect(
        (await get(`/files/${moved.body.data.fileId}/download`)).status,
      ).toBe(200);
    },
  );
  it.skipIf(!endpoint)(
    "rejects a legacy file cursor after catalog visibility changes",
    async () => {
      const uploadFile = async (name: string, visibility: "class" | "staff") =>
        request(app(instructor))
          .post(base + "/resources/files")
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .field("title", name)
          .field("visibility", visibility)
          .attach("file", Buffer.from(name), {
            filename: `${name}.txt`,
            contentType: "text/plain",
          });
      const first = await uploadFile("cursor-first", "class");
      const second = await uploadFile("cursor-second", "class");
      const hidden = await uploadFile("cursor-hidden", "staff");
      for (const result of [first, second, hidden])
        expect(result.status).toBe(201);
      const page = await get("/files?limit=1");
      expect(page.status).toBe(200);
      expect(page.body.data[0].id).toBe(second.body.data.fileId);
      expect(page.body.page.nextCursor).toEqual(expect.any(String));
      const published = await write(
        "patch",
        `/resources/${hidden.body.data.id}`,
        { visibility: "class" },
        `"v${hidden.body.data.version}"`,
      );
      expect(published.status).toBe(200);
      const stale = await get(
        `/files?limit=1&cursor=${encodeURIComponent(page.body.page.nextCursor)}`,
      );
      expect(stale.status).toBe(400);
      expect(stale.body.error.code).toBe("invalid_request");
      const fresh = await get("/files?limit=10");
      expect(fresh.status).toBe(200);
      expect(fresh.body.data.map((file: { id: string }) => file.id)).toContain(
        hidden.body.data.fileId,
      );
    },
  );
  it.skipIf(!endpoint)(
    "replays an identical catalog upload after archival without a new revision",
    async () => {
      const uploadFile = (key: string, title = "Archived replay") =>
        request(app(instructor))
          .post(base + "/resources/files")
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("Idempotency-Key", key)
          .field("title", title)
          .attach("file", Buffer.from("same bytes"), {
            filename: "replay.txt",
            contentType: "text/plain",
          });
      const first = await uploadFile("archived-catalog-upload");
      expect(first.status).toBe(201);
      const revisionsBefore = (
        await pool.query(
          "SELECT count(*)::int AS n FROM course_resource_revisions WHERE resource_id=$1",
          [first.body.data.id],
        )
      ).rows[0].n;
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      try {
        const replay = await uploadFile("archived-catalog-upload");
        expect(replay.status).toBe(201);
        expect(replay.body).toEqual(first.body);
        expect(
          (await uploadFile("archived-catalog-upload", "Changed")).status,
        ).toBe(409);
        expect((await uploadFile("fresh-archived-catalog-upload")).status).toBe(
          409,
        );
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM course_resource_revisions WHERE resource_id=$1",
              [first.body.data.id],
            )
          ).rows[0].n,
        ).toBe(revisionsBefore);
        await pool.query(
          "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
          [course, instructor],
        );
        expect((await uploadFile("archived-catalog-upload")).status).toBe(403);
      } finally {
        await pool.query(
          "UPDATE course_memberships SET role='instructor' WHERE course_id=$1 AND user_id=$2",
          [course, instructor],
        );
        await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
          course,
        ]);
      }
    },
  );
  it("validates complete conditional ordering and rejects unknown/repeated query fields", async () => {
    const collection = await get("/resource-sections", instructor),
      ids = collection.body.data.map((s: { id: string }) => s.id).reverse();
    expect(
      (
        await write(
          "put",
          "/resource-sections/order",
          { ids: [ids[0], ids[0]] },
          collection.headers.etag,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await write(
          "put",
          "/resource-sections/order",
          { ids },
          collection.headers.etag,
        )
      ).status,
    ).toBe(200);
    expect(
      (await get("/resource-sections", instructor)).body.data.map(
        (s: { id: string }) => s.id,
      ),
    ).toEqual(ids);
    expect(
      (
        await write(
          "put",
          "/resource-sections/order",
          { ids },
          collection.headers.etag,
        )
      ).status,
    ).toBe(412);
    for (const query of [
      "sort=x",
      "sort=date&sort=title",
      "sectionId=x&sectionId=y",
      "role=instructor",
    ])
      expect((await get("/resources?" + query)).status).toBe(400);
    const rows = await get("/resources", instructor),
      ungrouped = rows.body.data
        .filter((r: { sectionId: string | null }) => r.sectionId === null)
        .map((r: { id: string }) => r.id)
        .reverse();
    expect(
      (
        await write(
          "put",
          "/resources/order",
          { ids: ungrouped, sectionId: null },
          rows.headers.etag,
        )
      ).status,
    ).toBe(200);
    expect(
      (await get("/resources", instructor)).body.data
        .filter((r: { sectionId: string | null }) => r.sectionId === null)
        .map((r: { id: string }) => r.id),
    ).toEqual(ungrouped);
  });
  it.skipIf(!endpoint)(
    "denies other-course staff and demoted staff on direct and legacy file reads",
    async () => {
      const item = (await get("/resources", instructor)).body.data.find(
        (r: { kind: string; title: string }) =>
          r.kind === "upload" && r.title === "Staff syllabus",
      );
      expect(item).toBeDefined();
      const other = randomUUID();
      await pool.query(
        "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Other','ZZZZZZZZ')",
        [other, org, outsider],
      );
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'instructor')",
        [other, outsider],
      );
      expect(
        (await get(`/files/${item.fileId}/download`, outsider)).status,
      ).toBe(404);
      expect((await get(`/resources/${item.id}`, outsider)).status).toBe(404);
      await pool.query(
        "UPDATE course_memberships SET role='student' WHERE course_id=$1 AND user_id=$2",
        [course, ta],
      );
      expect((await get(`/files/${item.fileId}/download`, ta)).status).toBe(
        404,
      );
      expect((await get(`/resources/${item.id}`, ta)).status).toBe(404);
      await pool.query(
        "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
        [course, ta],
      );
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      expect((await get(`/files/${item.fileId}/download`, ta)).status).toBe(
        200,
      );
      expect(
        (
          await write(
            "delete",
            `/resources/${item.id}`,
            {},
            `"v${item.version}"`,
          )
        ).status,
      ).toBe(409);
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        course,
      ]);
    },
  );

  it.skipIf(!endpoint)(
    "preserves a current revision on invalid, stale, storage-failed and racing-archive replacement",
    async () => {
      const current = (await get("/resources", instructor)).body.data.find(
        (r: { kind: string }) => r.kind === "upload",
      );
      const replace = (
        etag = `"v${current.version}"`,
        name = "new.txt",
        type = "text/plain",
      ) =>
        request(app(instructor))
          .put(base + `/resources/${current.id}/file`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .set("If-Match", etag)
          .field("title", current.title)
          .field("sectionId", current.sectionId ?? "")
          .field("visibility", current.visibility)
          .attach("file", Buffer.from("Updated contents"), {
            filename: name,
            contentType: type,
          });
      expect((await replace('"v0"')).status).toBe(412);
      expect((await replace(undefined, "bad.png", "image/png")).status).toBe(
        415,
      );
      const fail = vi
        .spyOn(s3, "send")
        .mockRejectedValueOnce(new Error("storage offline"));
      expect((await replace()).status).toBe(503);
      fail.mockRestore();
      expect(
        (await get(`/resources/${current.id}`, instructor)).body.data.fileId,
      ).toBe(current.fileId);
      let started!: () => void, release!: () => void;
      const start = new Promise<void>((resolve) => {
          started = resolve;
        }),
        wait = new Promise<void>((resolve) => {
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
      const pending = replace().then((r) => r);
      await start;
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      release();
      expect((await pending).status).toBe(409);
      spy.mockRestore();
      expect(
        (await get(`/resources/${current.id}`, instructor)).body.data.fileId,
      ).toBe(current.fileId);
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        course,
      ]);
    },
  );
  it.skipIf(!endpoint)(
    "the separate worker cleans retired bytes and course deletion cascades the managed catalog",
    async () => {
      const keys = await pool.query<{ object_key: string }>(
        "SELECT object_key FROM course_files WHERE course_id=$1",
        [course],
      );
      expect(keys.rows.length).toBeGreaterThan(0);
      const deleted = await write("delete", "", {}, '"v1"');
      expect(deleted.status).toBe(202);
      expect(deleted.body.data.status).toBe("deleting");
      const worker = new JobWorker(
        pool,
        "resource-cleanup",
        undefined,
        undefined,
        { client: s3, bucket },
      );
      for (let n = 0; n < 20 && (await worker.runOnce()); n++);
      expect(
        (await pool.query("SELECT 1 FROM courses WHERE id=$1", [course]))
          .rowCount,
        JSON.stringify(
          (
            await pool.query(
              "SELECT kind,status,last_error,available_at FROM jobs",
            )
          ).rows,
        ),
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM course_resources WHERE course_id=$1",
            [course],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM course_resource_revisions WHERE course_id=$1",
            [course],
          )
        ).rowCount,
      ).toBe(0);
      for (const row of keys.rows)
        await expect(
          s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: row.object_key }),
          ),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect((await get("/resources")).status).toBe(404);
    },
  );
});
