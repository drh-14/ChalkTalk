import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { CourseFileService } from "../course-files/service.js";
import { CourseResourceService } from "../course-resources/service.js";
import { CourseService } from "../courses/service.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { createApp } from "./app.js";

const endpoint = process.env.TEST_S3_ENDPOINT,
  url = process.env.TEST_DATABASE_URL,
  suite = url && endpoint ? describe : describe.skip,
  bucket = `resource-text-${process.pid}-${Date.now()}`,
  s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "chalktalk-local",
      secretAccessKey: "chalktalk-local-secret",
    },
  });
const schema = `resource_text_http_${process.pid}_${Date.now()}`,
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
const base = `/api/v1/courses/${course}`;
const get = (target: string, user = student) =>
  request(app(user))
    .get(base + target)
    .set("Cookie", "__Host-chalktalk_session=opaque");
const unsafe = (
  method: "post" | "put" | "patch" | "delete",
  target: string,
  user = instructor,
) => {
  const agent = request(app(user));
  return agent[method](base + target)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
};
const upload = (
  fields: Record<string, string>,
  contents: string,
  options: { id?: string; etag?: string; key?: string; name?: string } = {},
) => {
  let call = unsafe(
    options.id ? "put" : "post",
    options.id ? `/resources/${options.id}/file` : "/resources/files",
  );
  if (options.etag) call = call.set("If-Match", options.etag);
  if (options.key) call = call.set("Idempotency-Key", options.key);
  for (const [name, value] of Object.entries(fields))
    call = call.field(name, value);
  return call.attach("file", Buffer.from(contents), {
    filename: options.name ?? "notes.txt",
    contentType: "text/plain",
  });
};
const extractionJobs = async () =>
  (
    await pool.query<{ file_id: string }>(
      "SELECT payload->>'fileId' file_id FROM jobs WHERE kind='extract_file_text' ORDER BY created_at,id",
    )
  ).rows.map((row) => row.file_id);
const texts = async () =>
  (
    await pool.query<{ file_id: string; status: string }>(
      "SELECT file_id,status FROM course_file_texts ORDER BY created_at,file_id",
    )
  ).rows;
/** Simulates a finished worker run for one file. */
const finish = (
  fileId: string,
  status: "ready" | "failed" | "unsupported",
  text?: string,
) =>
  pool.query(
    "UPDATE course_file_texts SET status=$2,text=$3,failure_code=$4,extracted_at=now() WHERE file_id=$1",
    [
      fileId,
      status,
      status === "ready" ? (text ?? "") : null,
      status === "ready" ? null : "test_failure",
    ],
  );

suite("resource text extraction", () => {
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
      "INSERT INTO organizations(id,domain,name) VALUES($1,'text.example.edu','Example')",
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
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Linear Algebra','TEXTHTTP')",
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
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  describe("queueing", () => {
    it("queues one pending extraction with each catalog upload and replacement", async () => {
      const before = await extractionJobs();
      const created = await upload({ title: "Week 1" }, "first", {
        key: "queue-create",
      });
      expect(created.status).toBe(201);
      expect(created.body.data.textStatus).toBe("pending");
      const first = created.body.data.fileId as string;
      expect(await extractionJobs()).toEqual([...before, first]);

      const replay = await upload({ title: "Week 1" }, "first", {
        key: "queue-create",
      });
      expect(replay.status).toBe(201);
      expect(await extractionJobs()).toEqual([...before, first]);

      const replaced = await upload({}, "second", {
        id: created.body.data.id,
        etag: created.headers.etag,
      });
      expect(replaced.status).toBe(200);
      const second = replaced.body.data.fileId as string;
      expect(second).not.toBe(first);
      expect(await extractionJobs()).toEqual([...before, first, second]);
      expect(
        (await texts()).filter((row) => [first, second].includes(row.file_id)),
      ).toEqual([
        { file_id: first, status: "pending" },
        { file_id: second, status: "pending" },
      ]);
    });

    it("leaves no text row or job when an upload fails", async () => {
      const created = await upload({ title: "Stale" }, "contents");
      const jobs = await extractionJobs(),
        rows = await texts();
      const stale = await upload({}, "replacement", {
        id: created.body.data.id,
        etag: '"v999"',
      });
      expect(stale.status).toBe(412);
      const studentUpload = await unsafe("post", "/resources/files", student)
        .field("title", "Student")
        .attach("file", Buffer.from("student"), {
          filename: "s.txt",
          contentType: "text/plain",
        });
      expect(studentUpload.status).toBe(403);
      expect(await extractionJobs()).toEqual(jobs);
      expect(await texts()).toEqual(rows);
    });
  });

  describe("catalog textStatus", () => {
    it("reports each extraction status on upload entries only", async () => {
      const section = await unsafe("post", "/resource-sections").send({
        title: "Statuses",
        visibility: "class",
      });
      const sectionId = section.body.data.id as string;
      const entries: Record<string, { id: string; fileId: string }> = {};
      for (const status of ["pending", "ready", "failed", "unsupported"]) {
        const created = await upload({ title: status, sectionId }, status);
        entries[status] = created.body.data;
      }
      await finish(entries.ready!.fileId, "ready", "words");
      await finish(entries.failed!.fileId, "failed");
      await finish(entries.unsupported!.fileId, "unsupported");
      const link = await unsafe("post", "/resources").send({
        kind: "link",
        title: "Handbook",
        url: "https://example.edu/handbook",
        sectionId,
      });
      expect(link.status).toBe(201);
      expect(link.body.data).not.toHaveProperty("textStatus");

      const listed = await get(`/resources?sectionId=${sectionId}&limit=10`);
      expect(listed.status).toBe(200);
      const byTitle = Object.fromEntries(
        listed.body.data.map((entry: { title: string }) => [
          entry.title,
          entry,
        ]),
      );
      for (const status of ["pending", "ready", "failed", "unsupported"]) {
        expect(byTitle[status].textStatus).toBe(status);
        const read = await get(`/resources/${entries[status]!.id}`);
        expect(read.body.data.textStatus).toBe(status);
        expect(read.body.data).not.toHaveProperty("text");
      }
      expect(byTitle.Handbook).not.toHaveProperty("textStatus");
    });

    it("does not change catalog ETags or cursors when extraction finishes", async () => {
      const created = await upload({ title: "Etag check" }, "etag");
      const before = await get("/resources?limit=1");
      const read = await get(`/resources/${created.body.data.id}`);
      await finish(created.body.data.fileId, "ready", "done");
      const after = await get("/resources?limit=1");
      expect(after.headers.etag).toBe(before.headers.etag);
      expect(after.body.page.nextCursor).toBe(before.body.page.nextCursor);
      expect(
        (await get(`/resources/${created.body.data.id}`)).headers.etag,
      ).toBe(read.headers.etag);
    });

    it("reports a file without a text row as pending", async () => {
      const created = await upload({ title: "No row" }, "missing");
      await pool.query("DELETE FROM course_file_texts WHERE file_id=$1", [
        created.body.data.fileId,
      ]);
      expect(
        (await get(`/resources/${created.body.data.id}`)).body.data.textStatus,
      ).toBe("pending");
    });
  });

  describe("search", () => {
    const search = (query: string, user = student) =>
      get(`/resources/search?${query}`, user);
    const titles = (body: { data: { resource: { title: string } }[] }) =>
      body.data.map((item) => item.resource.title);
    const readyFile = async (
      title: string,
      text: string,
      fields: Record<string, string> = {},
    ) => {
      const created = await upload({ title, ...fields }, text);
      await finish(created.body.data.fileId, "ready", text);
      return created;
    };

    it("finds a resource by words inside its extracted text with a highlighted snippet", async () => {
      await readyFile(
        "Lecture 7",
        "Today we prove that the eigenvalues of a real symmetric matrix are real.",
      );
      const found = await search("q=eigenvalue");
      expect(found.status).toBe(200);
      expect(found.headers["cache-control"]).toBe("private, no-store");
      expect(titles(found.body)).toEqual(["Lecture 7"]);
      const [item] = found.body.data;
      expect(item.resource).toMatchObject({
        kind: "upload",
        title: "Lecture 7",
        textStatus: "ready",
      });
      expect(item.match.inTitle).toBe(false);
      const { text, highlights } = item.match.snippet;
      expect(text.length).toBeLessThanOrEqual(300);
      expect(
        highlights.map((range: { start: number; length: number }) =>
          text.slice(range.start, range.start + range.length),
        ),
      ).toContain("eigenvalues");
      expect(found.body.page).toEqual({ hasMore: false, nextCursor: null });
    });

    it("ranks title matches above text-only matches", async () => {
      await readyFile("Notes on quadrics", "Quaternion rotations explained.");
      await readyFile("Quaternion primer", "Introductory notes.");
      const found = await search("q=quaternion");
      expect(titles(found.body)).toEqual([
        "Quaternion primer",
        "Notes on quadrics",
      ]);
      expect(found.body.data[0].match).toEqual({
        inTitle: true,
        snippet: null,
      });
    });

    it("matches misspelled title words and link titles without fetching them", async () => {
      await upload({ title: "Syllabus" }, "Course policies.");
      const link = await unsafe("post", "/resources").send({
        kind: "link",
        title: "Hyperbolic geometry applet",
        url: "https://example.edu/hyperbolic",
      });
      expect(link.status).toBe(201);
      expect(titles((await search("q=sylabus")).body)).toContain("Syllabus");
      const linked = await search("q=hyperbolic");
      expect(linked.body.data).toEqual([
        {
          resource: expect.objectContaining({
            kind: "link",
            url: "https://example.edu/hyperbolic",
          }),
          match: { inTitle: true, snippet: null },
        },
      ]);
      expect(linked.body.data[0].resource).not.toHaveProperty("textStatus");
    });

    it("ignores text until extraction is ready", async () => {
      const created = await upload(
        { title: "Ocelot worksheet" },
        "Contains the word xylophonic.",
      );
      expect((await search("q=xylophonic")).body.data).toEqual([]);
      expect(titles((await search("q=ocelot")).body)).toEqual([
        "Ocelot worksheet",
      ]);
      await finish(created.body.data.fileId, "ready", "Contains xylophonic.");
      expect(titles((await search("q=xylophonic")).body)).toEqual([
        "Ocelot worksheet",
      ]);
    });

    it("reports the catalog's text status for files without ready text", async () => {
      for (const status of ["pending", "failed", "unsupported"] as const) {
        const created = await upload(
          { title: `Ichthyology ${status}` },
          "Contents",
        );
        if (status !== "pending")
          await finish(created.body.data.fileId, status);
      }
      const found = await search("q=ichthyology");
      expect(
        Object.fromEntries(
          found.body.data.map(
            (item: { resource: { title: string; textStatus: string } }) => [
              item.resource.title,
              item.resource.textStatus,
            ],
          ),
        ),
      ).toEqual({
        "Ichthyology pending": "pending",
        "Ichthyology failed": "failed",
        "Ichthyology unsupported": "unsupported",
      });
      for (const item of found.body.data)
        expect(item.match).toEqual({ inTitle: true, snippet: null });
    });

    describe("close title misspellings", () => {
      it("ignores stop words, so a common word does not outrank the real match", async () => {
        await upload({ title: "The handbook" }, "Contents");
        await readyFile("Spectra", "Notes on the zeugmatic operator.");
        const found = await search(`q=${encodeURIComponent("the zeugmatic")}`);
        expect(titles(found.body)).toEqual(["Spectra"]);
        expect(found.body.data[0].match.inTitle).toBe(false);
      });

      it("requires every query word to match, as the lexical query does", async () => {
        await upload({ title: "Tessellation exam" }, "Contents");
        await upload({ title: "Pentagon guide" }, "Contents");
        expect(
          titles((await search(`q=${encodeURIComponent("matrix exam")}`)).body),
        ).not.toContain("Tessellation exam");
        expect(
          titles(
            (await search(`q=${encodeURIComponent("pentagn matrix")}`)).body,
          ),
        ).not.toContain("Pentagon guide");
        const close = await search(`q=${encodeURIComponent("pentagn guide")}`);
        expect(titles(close.body)).toEqual(["Pentagon guide"]);
        expect(close.body.data[0].match.inTitle).toBe(true);
      });

      it("does not fuzzy-match queries that use search operators", async () => {
        await upload({ title: "Algebraic exam" }, "Contents");
        await upload({ title: "Algebraic notes" }, "Contents");
        const negated = titles(
          (await search(`q=${encodeURIComponent("algebraic -exam")}`)).body,
        );
        expect(negated).toContain("Algebraic notes");
        expect(negated).not.toContain("Algebraic exam");
        await upload({ title: "Lemniscate exam" }, "Contents");
        expect(titles((await search("q=lemniscat")).body)).toContain(
          "Lemniscate exam",
        );
        expect(
          (await search(`q=${encodeURIComponent('"lemniscat"')}`)).body.data,
        ).toEqual([]);
        expect(
          (await search(`q=${encodeURIComponent("lemniscat OR zzzqqq")}`)).body
            .data,
        ).toEqual([]);
      });
    });

    it("returns markup-like extracted text as plain snippet text", async () => {
      const created = await upload({ title: "Web security" }, "Slides");
      await finish(
        created.body.data.fileId,
        "ready",
        "Never trust <script>alert('sanitize')</script> in user input.",
      );
      const snippet = (await search("q=sanitize")).body.data[0].match.snippet;
      expect(snippet.text).toContain("<script>alert('sanitize')</script>");
      expect(snippet.text).not.toMatch(/\p{Cc}|[\uE000\uE001]/u);
      expect(
        snippet.highlights.map((range: { start: number; length: number }) =>
          snippet.text.slice(range.start, range.start + range.length),
        ),
      ).toEqual(["sanitize"]);
    });

    it("hides staff-only resources from students before pagination", async () => {
      const staff = await unsafe("post", "/resource-sections").send({
        title: "Staff only",
        visibility: "staff",
      });
      await readyFile("Answer key", "Zygomorphic answer key.", {
        sectionId: staff.body.data.id,
      });
      await readyFile("Staff item", "Zygomorphic item.", {
        visibility: "staff",
      });
      await readyFile("Class handout", "Zygomorphic handout.");
      const asStudent = await search("q=zygomorphic&limit=1");
      expect(titles(asStudent.body)).toEqual(["Class handout"]);
      expect(asStudent.body.page).toEqual({ hasMore: false, nextCursor: null });
      const asTa = await search("q=zygomorphic", ta);
      expect(titles(asTa.body).sort()).toEqual([
        "Answer key",
        "Class handout",
        "Staff item",
      ]);
    });

    it("never returns removed resources or replaced files' text", async () => {
      const removed = await readyFile("Removed notes", "Quokka habitat.");
      const deleted = await unsafe(
        "delete",
        `/resources/${removed.body.data.id}`,
      ).set("If-Match", removed.headers.etag);
      expect(deleted.status).toBe(204);
      expect((await search("q=quokka")).body.data).toEqual([]);

      const replaced = await readyFile("Replaced notes", "Wombat burrows.");
      const next = await upload({}, "New contents", {
        id: replaced.body.data.id,
        etag: replaced.headers.etag,
      });
      expect(next.status).toBe(200);
      expect(
        (
          await pool.query(
            "SELECT status FROM course_file_texts WHERE file_id=$1",
            [replaced.body.data.fileId],
          )
        ).rows[0].status,
      ).toBe("ready");
      expect((await search("q=wombat")).body.data).toEqual([]);
    });

    it("pages with cursors bound to the query and viewer", async () => {
      for (const index of [1, 2, 3])
        await readyFile(`Paging ${index}`, `Narwhal facts ${index}.`);
      const first = await search("q=narwhal&limit=2");
      expect(first.body.data).toHaveLength(2);
      expect(first.body.page.hasMore).toBe(true);
      const cursor = first.body.page.nextCursor as string;
      const second = await search(
        `q=narwhal&limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(second.body.data).toHaveLength(1);
      expect(
        new Set([...titles(first.body), ...titles(second.body)]).size,
      ).toBe(3);
      for (const [query, user] of [
        [`q=other&cursor=${cursor}`, student],
        [`q=narwhal&cursor=${cursor}`, ta],
        ["q=narwhal&cursor=bm90LWpzb24", student],
      ] as const)
        expect((await search(query, user)).status).toBe(400);
    });

    it("keeps archived courses searchable and hides the course from non-members", async () => {
      await readyFile("Archived reading", "Pangolin scales.");
      await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
        course,
      ]);
      try {
        expect(titles((await search("q=pangolin")).body)).toEqual([
          "Archived reading",
        ]);
      } finally {
        await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
          course,
        ]);
      }
      const outside = await search("q=pangolin", outsider);
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe("not_found");
    });

    it("returns not_found after membership is removed", async () => {
      const former = randomUUID();
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,'Eve','x')",
        [former, org, `${former}@example.edu`],
      );
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
        [course, former],
      );
      expect((await search("q=anything", former)).status).toBe(200);
      await pool.query(
        "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
        [course, former],
      );
      expect((await search("q=anything", former)).status).toBe(404);
    });

    it("rejects invalid queries", async () => {
      for (const query of [
        "",
        "q=",
        "q=%20%20",
        `q=${"a".repeat(201)}`,
        "q=a&q=b",
        "q=a&limit=0",
        "q=a&limit=51",
        "q=a&limit=1.5",
        "q=a&sort=title",
        "q=a&cursor=",
        `q=a&cursor=${"a".repeat(2049)}`,
      ]) {
        const response = await search(query);
        expect(response.status, query).toBe(400);
        expect(response.body.error.code).toBe("invalid_request");
      }
      expect((await search(`q=${"é".repeat(200)}`)).status).toBe(200);
    });

    it("requires authentication and an available service", async () => {
      const anonymous = await request(app(student)).get(
        `${base}/resources/search?q=a`,
      );
      expect(anonymous.status).toBe(401);
      const unavailable = await request(
        createApp({
          environment,
          authService: {
            session: async () => ({
              id: randomUUID(),
              user: {
                id: student,
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
        }),
      )
        .get(`${base}/resources/search?q=a`)
        .set("Cookie", "__Host-chalktalk_session=opaque");
      expect(unavailable.status).toBe(503);
      expect(unavailable.body.error.code).toBe("service_unavailable");
    });
  });
});
