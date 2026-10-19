import { CourseResourceService } from "../course-resources/service.js";
import request from "supertest";
import { expect, it } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "./app.js";
const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
});
it("requires authentication for unified resource listing", async () => {
  const result = await request(createApp({ environment })).get(
    "/api/v1/courses/00000000-0000-4000-8000-000000000001/resources",
  );
  expect(result.status).toBe(401);
});

import { Pool } from "pg";
import { v7 as uuid } from "uuid";
import { beforeAll, afterAll, describe } from "vitest";
import type { AuthService } from "../auth/service.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const schema = `resource_links_${process.pid}_${Date.now()}`;
const ids = {
  org: uuid(),
  course: uuid(),
  other: uuid(),
  instructor: uuid(),
  ta: uuid(),
  student: uuid(),
  outsider: uuid(),
};
let admin: Pool, pool: Pool;
function app(user = ids.instructor) {
  return createApp({
    environment,
    courseResourceService: new CourseResourceService(pool),
    authService: {
      session: async () => ({
        id: uuid(),
        user: { id: user },
        csrfToken: "csrf",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    } as AuthService,
  });
}
const list = (user = ids.student, query = "", course = ids.course) =>
  request(app(user))
    .get(`/api/v1/courses/${course}/resources${query}`)
    .set("Cookie", "__Host-chalktalk_session=opaque");
const post = (
  body: unknown = {
    kind: "link",
    title: "Course handbook",
    url: "https://example.edu/handbook",
  },
  key?: string,
  user = ids.instructor,
  course = ids.course,
) => {
  let req = request(app(user))
    .post(`/api/v1/courses/${course}/resources`)
    .set("Cookie", "__Host-chalktalk_session=opaque")
    .set("Origin", environment.frontendBaseUrl)
    .set("X-CSRF-Token", "csrf");
  if (key !== undefined) req = req.set("Idempotency-Key", key);
  return req.send(body);
};
integration("flat course resources HTTP/PostgreSQL contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations(id,domain,name) VALUES($1,'example.edu','Example')",
      [ids.org],
    );
    for (const [name, id] of Object.entries(ids).filter(
      ([name]) => !["org", "course", "other"].includes(name),
    ))
      await pool.query(
        "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,'x')",
        [id, ids.org, `${name}@example.edu`, name],
      );
    for (const id of [ids.course, ids.other])
      await pool.query(
        "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Resources',$4)",
        [
          id,
          ids.org,
          ids.instructor,
          id === ids.course ? "COURSE12" : "OTHER123",
        ],
      );
    for (const [user, role] of [
      [ids.instructor, "instructor"],
      [ids.ta, "ta"],
      [ids.student, "student"],
    ])
      await pool.query(
        "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,$3)",
        [ids.course, user, role],
      );
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });
  it("creates public named links transactionally with stable idempotency and archive replay", async () => {
    const body = {
      kind: "link",
      title: "Course handbook",
      url: "https://example.edu/handbook?q=1#start",
    };
    const first = await post(body, "link-retry");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.headers.location).toBe(
      `/api/v1/courses/${ids.course}/resources`,
    );
    expect(first.body.data).toEqual({
      kind: "link",
      id: expect.any(String),
      courseId: ids.course,
      title: body.title,
      url: body.url,
      createdAt: expect.any(String),
    });
    const [a, b] = await Promise.all([
      post(body, "link-retry"),
      post(body, "link-retry"),
    ]);
    expect(a.body).toEqual(first.body);
    expect(b.body).toEqual(first.body);
    expect(
      (await post({ ...body, title: "Changed" }, "link-retry")).status,
    ).toBe(409);
    expect(
      (await pool.query("SELECT count(*)::int AS n FROM course_resource_links"))
        .rows[0].n,
    ).toBe(1);
    await pool.query("UPDATE courses SET status='archived' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect((await post(body, "link-retry")).body).toEqual(first.body);
      expect((await post(body, "new")).status).toBe(409);
      expect((await list()).status).toBe(200);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    await pool.query(
      "UPDATE course_memberships SET role='ta' WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.instructor],
    );
    try {
      expect((await post(body, "link-retry")).status).toBe(403);
    } finally {
      await pool.query(
        "UPDATE course_memberships SET role='instructor' WHERE course_id=$1 AND user_id=$2",
        [ids.course, ids.instructor],
      );
    }
  });
  it("pages mixed actual files and links using exact microseconds and kind tie-breaks", async () => {
    const same = uuid();
    for (const [id, date] of [
      [same, "2090-01-01T00:00:00.123456Z"],
      [uuid(), "2090-01-01T00:00:00.123455Z"],
    ])
      await pool.query(
        "INSERT INTO course_resource_links(id,course_id,title,url,created_by_user_id,created_at) VALUES($1,$2,'Mixed link','https://example.edu',$3,$4)",
        [id, ids.course, ids.instructor, date],
      );
    await pool.query(
      "INSERT INTO course_files(id,course_id,uploaded_by_user_id,object_key,file_name,media_type,size_bytes,checksum_sha256,created_at) VALUES($1,$2,$3,'test-only-key','Lecture.txt','text/plain',1,$4,'2090-01-01T00:00:00.123456Z')",
      [same, ids.course, ids.instructor, Buffer.alloc(32)],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    let firstCursor = "";
    do {
      const page = await list(
        ids.student,
        `?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      expect(page.headers["cache-control"]).toBe("private, no-store");
      expect(page.body.data).toHaveLength(1);
      seen.push(`${page.body.data[0].kind}:${page.body.data[0].id}`);
      cursor = page.body.page.nextCursor;
      if (!firstCursor) firstCursor = cursor ?? "";
    } while (cursor);
    expect(seen.slice(0, 2)).toEqual([`upload:${same}`, `link:${same}`]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(4);
    expect((await list(ids.ta)).status).toBe(200);
    await pool.query("UPDATE course_files SET deleted_at=now() WHERE id=$1", [
      same,
    ]);
    expect(
      (await list()).body.data.every(
        (x: { kind: string }) => x.kind === "link",
      ),
    ).toBe(true);
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.1",
      "limit=1e1",
      "limit=1&limit=2",
      "cursor=x&cursor=y",
      "cursor=",
      "cursor=bad",
      "title=x",
    ])
      expect((await list(ids.student, `?${query}`)).status, query).toBe(400);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
      [ids.other, ids.student],
    );
    expect(
      (await list(ids.student, `?cursor=${firstCursor}`, ids.other)).status,
    ).toBe(400);
    expect((await list(ids.student, "", ids.other)).body.data).toEqual([]);
    const fileCursor = Buffer.from(
      JSON.stringify([ids.course, "2090-01-01T00:00:00.123456Z", same]),
    ).toString("base64url");
    expect((await list(ids.student, `?cursor=${fileCursor}`)).status).toBe(400);
  });
  it("enforces body,URL,title,key,Origin,CSRF and role boundaries without writes", async () => {
    const valid = { kind: "link", title: "Notes", url: "https://example.edu" };
    for (const body of [
      { ...valid, title: "" },
      { ...valid, title: "   " },
      { ...valid, title: "x".repeat(201) },
      { ...valid, url: "javascript:alert(1)" },
      { ...valid, url: "//example.edu" },
      { ...valid, url: "https://u:p@example.edu" },
      { ...valid, url: "https://example.edu/" + "x".repeat(2048) },
      { ...valid, url: "file:///tmp/x" },
      { ...valid, url: "https://" },
      { ...valid, kind: "upload" },
      { ...valid, description: "not allowed" },
      { title: "Missing URL" },
    ]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(r.body.error.code).toBe("validation_failed");
    }
    expect((await post(valid, "x".repeat(256))).status).toBe(422);
    for (const user of [ids.ta, ids.student, ids.outsider])
      expect((await post(valid, undefined, user)).status).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/courses/${ids.course}/resources`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .send(valid)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/courses/${ids.course}/resources`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", "https://evil.example")
          .set("X-CSRF-Token", "csrf")
          .send(valid)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app())
          .post(`/api/v1/courses/${ids.course}/resources`)
          .set("Origin", environment.frontendBaseUrl)
          .send(valid)
      ).status,
    ).toBe(401);
  });
  it("counts link boundaries as code points and rejects raw URL whitespace and controls", async () => {
    const prefix = "https://example.edu/";
    const title = "😀".repeat(200);
    const url = prefix + "😀".repeat(2048 - [...prefix].length);
    for (const body of [
      { kind: "link", title, url: "https://example.edu/%20notes" },
      { kind: "link", title: "Notes", url },
      { kind: "link", title: "Notes", url: "https://example.edu/é" },
    ]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body).slice(0, 100)).toBe(201);
      const stored = await pool.query(
        "SELECT title,url,length(title) AS title_length,length(url) AS url_length FROM course_resource_links WHERE id=$1",
        [response.body.data.id],
      );
      expect(stored.rows[0].title).toBe(body.title);
      expect(stored.rows[0].url).toBe(body.url);
      expect(stored.rows[0].title_length).toBe([...body.title].length);
      expect(stored.rows[0].url_length).toBe([...body.url].length);
      await pool.query("DELETE FROM course_resource_links WHERE id=$1", [
        response.body.data.id,
      ]);
    }
    for (const candidateUrl of [
      url + "😀",
      "https://example.edu/a b",
      "https://example.edu/a\u00a0b",
      "https://example.edu/a\u00a0",
      "https://example.edu/a\u2028b",
      "https://example.edu/a\u000bb",
      "https://example.edu/a\u0085b",
    ])
      expect(
        (await post({ kind: "link", title: "Notes", url: candidateUrl }))
          .status,
      ).toBe(422);
    expect(
      (await post({ kind: "link", title: title + "😀", url: prefix })).status,
    ).toBe(422);
  });
  it("hides inaccessible,deleting and missing courses and removed/deleted members", async () => {
    expect((await list(ids.outsider)).status).toBe(404);
    expect((await list(ids.student, "", uuid())).status).toBe(404);
    await pool.query("UPDATE courses SET status='deleting' WHERE id=$1", [
      ids.course,
    ]);
    try {
      expect((await list()).status).toBe(404);
      expect((await post()).status).toBe(409);
    } finally {
      await pool.query("UPDATE courses SET status='active' WHERE id=$1", [
        ids.course,
      ]);
    }
    await pool.query(
      "DELETE FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [ids.course, ids.student],
    );
    expect((await list()).status).toBe(404);
    await pool.query(
      "INSERT INTO course_memberships(course_id,user_id,role) VALUES($1,$2,'student')",
      [ids.course, ids.student],
    );
    await pool.query("UPDATE users SET deleted_at=now() WHERE id=$1", [
      ids.student,
    ]);
    try {
      expect((await list()).status).toBe(404);
    } finally {
      await pool.query("UPDATE users SET deleted_at=NULL WHERE id=$1", [
        ids.student,
      ]);
    }
  });
  it("expires keys, rejects stale replays and rolls back link creation with its response record", async () => {
    const body = {
      kind: "link",
      title: "Expiry link",
      url: "http://example.edu/expiry",
    };
    const first = await post(body, "expiry");
    expect(first.status).toBe(201);
    await pool.query(
      "UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE key='expiry'",
    );
    const second = await post(body, "expiry");
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    await pool.query("DELETE FROM course_resource_links WHERE id=$1", [
      second.body.data.id,
    ]);
    expect((await post(body, "expiry")).status).toBe(409);
    const before = (
      await pool.query("SELECT count(*)::int AS n FROM course_resource_links")
    ).rows[0].n;
    await pool.query(
      `CREATE FUNCTION fail_resource_idempotency() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='force-rollback' THEN RAISE EXCEPTION 'forced response failure'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      "CREATE TRIGGER fail_resource_idempotency BEFORE INSERT ON idempotency_records FOR EACH ROW EXECUTE FUNCTION fail_resource_idempotency()",
    );
    try {
      expect((await post(body, "force-rollback")).status).toBe(500);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM course_resource_links",
          )
        ).rows[0].n,
      ).toBe(before);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM idempotency_records WHERE key='force-rollback'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.query(
        "DROP TRIGGER fail_resource_idempotency ON idempotency_records",
      );
      await pool.query("DROP FUNCTION fail_resource_idempotency()");
    }
  });
  it("trims titles, rejects raw URL whitespace and malformed cursors", async () => {
    const result = await post({
      kind: "link",
      title: "  Trimmed title  ",
      url: "http://example.edu/path?q=1#part",
    });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      title: "Trimmed title",
      url: "http://example.edu/path?q=1#part",
    });
    for (const url of [
      "  http://example.edu/path?q=1#part  ",
      "https://example.edu/space here",
      "https://example.edu/\\path",
      "https://u%40example.edu@example.org",
      "https://example.edu/\npath",
    ]) {
      expect(
        (await post({ kind: "link", title: "Bad URL", url })).status,
        url,
      ).toBe(422);
    }
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const cursor of [
      "a".repeat(2049),
      encode([
        "course-files:v1",
        ids.course,
        "2090-01-01T00:00:00.123456Z",
        uuid(),
        "link",
      ]),
      encode([
        "course-resources:v1",
        ids.course,
        "2090-02-30T00:00:00.123456Z",
        uuid(),
        "link",
      ]),
      encode([
        "course-resources:v1",
        ids.course,
        "0000-01-01T00:00:00.123456Z",
        uuid(),
        "link",
      ]),
      encode([
        "course-resources:v1",
        ids.course,
        "2090-01-01T00:00:00.123456Z",
        uuid(),
        "other",
      ]),
      encode({ id: uuid() }),
    ])
      expect((await list(ids.student, `?cursor=${cursor}`)).status).toBe(400);
    const cors = await list().set("Origin", environment.frontendBaseUrl);
    expect(cors.status).toBe(200);
    expect(cors.headers["access-control-allow-origin"]).toBe(
      environment.frontendBaseUrl,
    );
    expect(cors.headers["access-control-allow-credentials"]).toBe("true");
    expect(
      (
        await post(
          { kind: "link", title: "Blank key", url: "https://example.edu" },
          "",
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await request(app())
          .post(`/api/v1/courses/${ids.course}/resources`)
          .set("Cookie", "__Host-chalktalk_session=opaque")
          .set("Origin", environment.frontendBaseUrl)
          .set("X-CSRF-Token", "csrf")
          .type("text")
          .send("link")
      ).status,
    ).toBe(422);
  });
  it("enforces minimal database constraints, course cascade and nullable creator attribution", async () => {
    for (const [title, url] of [
      ["   ", "https://example.edu"],
      ["x".repeat(201), "https://example.edu"],
      ["Bad", "ftp://example.edu"],
      ["Bad", "https://example.edu/" + "x".repeat(2048)],
    ])
      await expect(
        pool.query(
          "INSERT INTO course_resource_links(id,course_id,title,url) VALUES($1,$2,$3,$4)",
          [uuid(), ids.course, title, url],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    const longTitle = "😀".repeat(200);
    const longUrl = "https://example.edu/" + "😀".repeat(2028);
    const id = uuid();
    await pool.query(
      "INSERT INTO course_resource_links(id,course_id,title,url) VALUES($1,$2,$3,$4)",
      [id, ids.course, longTitle, longUrl],
    );
    expect(
      (
        await pool.query(
          "SELECT length(title) AS title_length,length(url) AS url_length FROM course_resource_links WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({ title_length: 200, url_length: 2048 });
    await pool.query("DELETE FROM course_resource_links WHERE id=$1", [id]);
    for (const [title, url] of [
      [longTitle + "😀", "https://example.edu"],
      ["Notes", longUrl + "😀"],
    ])
      await expect(
        pool.query(
          "INSERT INTO course_resource_links(id,course_id,title,url) VALUES($1,$2,$3,$4)",
          [uuid(), ids.course, title, url],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    const course = uuid(),
      creator = uuid(),
      link = uuid();
    await pool.query(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,'temporary@example.edu','Temporary','x')",
      [creator, ids.org],
    );
    await pool.query(
      "INSERT INTO courses(id,organization_id,created_by_user_id,name,join_code) VALUES($1,$2,$3,'Cascade','CASCADE1')",
      [course, ids.org, ids.instructor],
    );
    await pool.query(
      "INSERT INTO course_resource_links(id,course_id,title,url,created_by_user_id) VALUES($1,$2,'Shared link','https://example.edu',$3)",
      [link, course, creator],
    );
    await pool.query("DELETE FROM users WHERE id=$1", [creator]);
    expect(
      (
        await pool.query(
          "SELECT created_by_user_id FROM course_resource_links WHERE id=$1",
          [link],
        )
      ).rows[0].created_by_user_id,
    ).toBeNull();
    await pool.query("DELETE FROM courses WHERE id=$1", [course]);
    expect(
      (
        await pool.query("SELECT 1 FROM course_resource_links WHERE id=$1", [
          link,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("rejects a NUL-containing title at the API boundary", async () => {
    expect(
      (
        await post({
          kind: "link",
          title: "Bad\u0000title",
          url: "https://example.edu",
        })
      ).status,
    ).toBe(422);
  });
});
