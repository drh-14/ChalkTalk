import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { CourseService, courseEtag } from "./service.js";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../auth/service.js";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "../http/app.js";
import { JobWorker } from "../jobs/worker.js";

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `courses_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
let service: CourseService;
const owner = "11111111-1111-4111-8111-111111111111";
const guest = "22222222-2222-4222-8222-222222222222";
const organization = "33333333-3333-4333-8333-333333333333";
const guestOrganization = "44444444-4444-4444-8444-444444444444";

integration("CourseService PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: url,
      options: `--search_path="${schema}"`,
    });
    await runMigrations(pool, getMigrationDirectory());
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'example.edu','Example'),($2,'guest.edu','Guest')",
      [organization, guestOrganization],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$3,'owner@example.edu','Owner','x'),($2,$4,'guest@guest.edu','Guest','x')",
      [owner, guest, organization, guestOrganization],
    );
    service = new CourseService(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });
  it("creates an instructor course, permits a cross-organization-style join, and protects its final instructor", async () => {
    const course = await service.create(organization, owner, "Compilers");
    expect(course.joinCode).toMatch(/^[A-Z0-9]{8}$/);
    const membership = await service.join(course.id, guest, course.joinCode);
    expect(membership.role).toBe("student");
    await expect(
      service.removeMember(course.id, owner, owner, undefined, true),
    ).rejects.toMatchObject({
      status: 409,
      code: "last_instructor",
    } satisfies Partial<AuthError>);
    await expect(
      service.update(course.id, owner, courseEtag(course), {
        status: "archived",
      }),
    ).resolves.toMatchObject({ status: "archived" });
  });
  it("marks deletion durably and worker-visible", async () => {
    const course = await service.create(organization, owner, "Networks");
    const deleting = await service.delete(course.id, owner, courseEtag(course));
    expect(deleting.status).toBe("deleting");
    const job = await pool.query<{
      kind: string;
      courseId: string;
      deduplicationKey: string;
    }>(
      "SELECT kind,payload->>'courseId' AS \"courseId\",deduplication_key AS \"deduplicationKey\" FROM jobs WHERE payload->>'courseId'=$1",
      [course.id],
    );
    expect(job.rows).toEqual([
      {
        kind: "delete_course",
        courseId: course.id,
        deduplicationKey: `course-delete:${course.id}`,
      },
    ]);
    await expect(
      service.delete(course.id, owner, courseEtag(deleting)),
    ).rejects.toMatchObject({ status: 409, code: "course_deleting" });
    await expect(new JobWorker(pool, "course-test").runOnce()).resolves.toBe(
      true,
    );
    await expect(service.get(course.id, owner)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
  it("does not duplicate a concurrent idempotent join", async () => {
    const course = await service.create(organization, owner, "Algorithms");
    const idempotent = service as unknown as {
      joinIdempotently: (
        courseId: string,
        userId: string,
        code: string,
        key: string,
        body: unknown,
      ) => Promise<{ value: unknown; status: number }>;
    };
    const [first, second] = await Promise.all([
      idempotent.joinIdempotently(
        course.id,
        guest,
        course.joinCode!,
        "same-key",
        { joinCode: course.joinCode },
      ),
      idempotent.joinIdempotently(
        course.id,
        guest,
        course.joinCode!,
        "same-key",
        { joinCode: course.joinCode },
      ),
    ]);
    expect(first).toEqual(second);
    const rows = await pool.query(
      "SELECT 1 FROM course_memberships WHERE course_id=$1 AND user_id=$2",
      [course.id, guest],
    );
    expect(rows.rowCount).toBe(1);
    await expect(
      idempotent.joinIdempotently(
        course.id,
        guest,
        course.joinCode!,
        "same-key",
        { joinCode: "AAAAAAAA" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_key_reused" });
  });
  it("does not duplicate a concurrent idempotent create", async () => {
    const [first, second] = await Promise.all([
      service.createIdempotently(
        organization,
        owner,
        "Databases",
        "create-key",
        { name: "Databases" },
      ),
      service.createIdempotently(
        organization,
        owner,
        "Databases",
        "create-key",
        { name: "Databases" },
      ),
    ]);
    expect(first).toEqual(second);
    const rows = await pool.query(
      "SELECT 1 FROM courses WHERE name='Databases'",
    );
    expect(rows.rowCount).toBe(1);
    await expect(
      service.createIdempotently(
        organization,
        owner,
        "Different",
        "create-key",
        { name: "Different" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_key_reused" });
  });
  it("requires an instructor for explicit removal even when a student targets themself", async () => {
    const course = await service.create(organization, owner, "Authorization");
    const joined = await service.join(course.id, guest, course.joinCode!);
    await expect(
      service.removeMember(course.id, guest, guest, courseEtag(joined)),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(
      service.getMember(course.id, guest, guest),
    ).resolves.toMatchObject({
      user: { id: guest },
    });
    await expect(
      service.removeMember(course.id, guest, guest, undefined, true),
    ).resolves.toBeUndefined();
  });
  it("allows reuse of an idempotency key after its 24-hour record expires", async () => {
    const first = await service.createIdempotently(
      organization,
      owner,
      "Before expiry",
      "expired-create",
      { name: "Before expiry" },
    );
    await pool.query(
      "UPDATE idempotency_records SET expires_at=now()-interval '1 second' WHERE key='expired-create'",
    );
    const second = await service.createIdempotently(
      organization,
      owner,
      "After expiry",
      "expired-create",
      { name: "After expiry" },
    );
    expect(second.value.id).not.toBe(first.value.id);
    expect(second.value.name).toBe("After expiry");
    await expect(
      service.createIdempotently(
        organization,
        owner,
        "Different again",
        "expired-create",
        { name: "Different again" },
      ),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_key_reused" });
  });
  it("rejects an empty optional idempotency key rather than treating it as absent", async () => {
    await expect(
      service.createIdempotently(organization, owner, "No key", "", {
        name: "No key",
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    const created = await service.create(organization, owner, "For join key");
    await expect(
      service.joinIdempotently(created.id, guest, created.joinCode!, "", {
        joinCode: created.joinCode,
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed" });
  });
  it("enforces explicit removal and empty idempotency keys through HTTP", async () => {
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      ALLOWED_SCHOOL_DOMAINS: "example.edu",
      FRONTEND_ORIGINS: "https://app.example.edu",
      FRONTEND_BASE_URL: "https://app.example.edu",
    });
    const app = createApp({
      environment,
      authService: {
        session: async () => ({
          id: "guest-session",
          user: {
            id: guest,
            email: "guest@guest.edu",
            displayName: "Guest",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          csrfToken: "csrf",
        }),
      } as AuthService,
      courseService: service,
    });
    const created = await service.create(
      organization,
      owner,
      "HTTP permissions",
    );
    const joined = await service.join(created.id, guest, created.joinCode!);
    const forbidden = await request(app)
      .delete(`/api/v1/courses/${created.id}/members/${guest}`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("If-Match", courseEtag(joined));
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe("not_found");
    const emptyKey = await request(app)
      .post(`/api/v1/courses/${created.id}/members`)
      .set("Cookie", "__Host-chalktalk_session=opaque")
      .set("Origin", environment.frontendBaseUrl)
      .set("X-CSRF-Token", "csrf")
      .set("Idempotency-Key", "")
      .send({ joinCode: created.joinCode });
    expect(emptyKey.status).toBe(422);
    expect(emptyKey.body.error.code).toBe("validation_failed");
  });
  it("stores implemented resources using the documented database types and idempotency key", async () => {
    const columns = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
    }>(
      `SELECT table_name,column_name,data_type,character_maximum_length
       FROM information_schema.columns WHERE table_schema=current_schema()
       AND table_name IN ('organizations','courses','course_memberships','idempotency_records')`,
    );
    const fields = new Map(
      columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
    );
    expect(fields.get("organizations.domain")).toMatchObject({
      data_type: "character varying",
      character_maximum_length: 253,
    });
    expect(fields.get("organizations.name")).toMatchObject({
      data_type: "character varying",
      character_maximum_length: 200,
    });
    expect(fields.get("courses.name")).toMatchObject({
      data_type: "character varying",
      character_maximum_length: 200,
    });
    for (const table of ["organizations", "courses", "course_memberships"])
      expect(fields.get(`${table}.version`)).toMatchObject({
        data_type: "bigint",
      });
    expect(fields.get("idempotency_records.key")).toMatchObject({
      data_type: "character varying",
      character_maximum_length: 255,
    });
    for (const column of [
      "state",
      "response_status",
      "response_headers",
      "response_body",
      "updated_at",
    ])
      expect(fields.has(`idempotency_records.${column}`)).toBe(true);
    const primary = await pool.query<{ column_name: string }>(
      `SELECT kcu.column_name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
       WHERE tc.table_schema=current_schema() AND tc.table_name='idempotency_records' AND tc.constraint_type='PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
    );
    expect(primary.rows.map((row) => row.column_name)).toEqual([
      "scope",
      "key",
    ]);
    await expect(
      pool.query(
        "INSERT INTO idempotency_records (scope,key,request_hash,response_status,expires_at) VALUES ('invalid-empty-key','',decode('00','hex'),201,now()+interval '1 day')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool.query(
        "INSERT INTO organizations (id,domain,name) VALUES ('99999999-9999-4999-8999-999999999999','UPPER.edu','Invalid')",
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("fails migration clearly instead of truncating an invalid existing organization domain", async () => {
    const invalidSchema = `${schema}_invalid`;
    await admin.query(`CREATE SCHEMA "${invalidSchema}"`);
    const isolated = new Pool({
      connectionString: url,
      options: `--search_path="${invalidSchema}"`,
    });
    try {
      for (const name of [
        "001_create_migration_ledger.sql",
        "002_authentication.sql",
        "003_courses_and_jobs.sql",
      ])
        await isolated.query(
          await readFile(join(getMigrationDirectory(), name), "utf8"),
        );
      await isolated.query(
        "INSERT INTO organizations (id,domain,name) VALUES ('88888888-8888-4888-8888-888888888888','UPPER.edu','Invalid')",
      );
      await expect(
        isolated.query(
          await readFile(
            join(getMigrationDirectory(), "004_course_contract_parity.sql"),
            "utf8",
          ),
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining("domain must be normalized"),
      });
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${invalidSchema}" CASCADE`);
    }
  });
  it("upgrades existing 003 idempotency responses without losing replay data", async () => {
    const upgradeSchema = `${schema}_upgrade`;
    await admin.query(`CREATE SCHEMA "${upgradeSchema}"`);
    const isolated = new Pool({
      connectionString: url,
      options: `--search_path="${upgradeSchema}"`,
    });
    try {
      for (const name of [
        "001_create_migration_ledger.sql",
        "002_authentication.sql",
        "003_courses_and_jobs.sql",
      ])
        await isolated.query(
          await readFile(join(getMigrationDirectory(), name), "utf8"),
        );
      await isolated.query(
        `INSERT INTO idempotency_records (id,scope,key,request_hash,status_code,response_body,expires_at)
         VALUES ('77777777-7777-4777-8777-777777777777','upgrade','retained',decode('ab','hex'),201,'{"data":{"id":"old"}}',now()+interval '1 day')`,
      );
      await isolated.query(
        await readFile(
          join(getMigrationDirectory(), "004_course_contract_parity.sql"),
          "utf8",
        ),
      );
      const record = await isolated.query<{
        scope: string;
        key: string;
        state: string;
        response_status: number;
        response_headers: unknown;
        response_body: unknown;
      }>(
        "SELECT scope,key,state,response_status,response_headers,response_body FROM idempotency_records WHERE scope='upgrade' AND key='retained'",
      );
      expect(record.rows).toEqual([
        {
          scope: "upgrade",
          key: "retained",
          state: "completed",
          response_status: 201,
          response_headers: null,
          response_body: { data: { id: "old" } },
        },
      ]);
    } finally {
      await isolated.end();
      await admin.query(`DROP SCHEMA "${upgradeSchema}" CASCADE`);
    }
  });
  it("returns bigint-backed revisions as JSON numbers with matching ETags", async () => {
    const created = await service.create(organization, owner, "Revisions");
    const membership = await service.join(created.id, guest, created.joinCode!);
    const organizationRecord = (await service.organizations(owner))[0]!;
    expect(organizationRecord.version).toBe(1);
    expect(typeof organizationRecord.version).toBe("number");
    const retrieved = await service.get(created.id, owner);
    expect(retrieved.version).toBe(1);
    expect(courseEtag(retrieved)).toBe('"v1"');
    const member = await service.getMember(created.id, guest, guest);
    expect(member.version).toBe(1);
    expect(courseEtag(member)).toBe('"v1"');
    const updated = await service.updateMember(
      created.id,
      owner,
      guest,
      courseEtag(membership),
      "ta",
    );
    expect(updated.version).toBe(2);
    expect(courseEtag(updated)).toBe('"v2"');
  });
  it("paginates member courses by a stable created-at and UUID keyset", async () => {
    const pageUser = "55555555-5555-4555-8555-555555555555";
    const courseIds = [
      "55555555-5555-4555-8555-555555555551",
      "55555555-5555-4555-8555-555555555552",
      "55555555-5555-4555-8555-555555555553",
    ];
    const timestamp = "2026-09-01T12:00:00.000Z";
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'page-user@example.edu','Page user','x')",
      [pageUser, organization],
    );
    for (const [index, courseId] of courseIds.entries()) {
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
        [
          courseId,
          organization,
          pageUser,
          `Page course ${index}`,
          `PAGE${index}ABC`,
          timestamp,
        ],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role,created_at,updated_at) VALUES ($1,$2,'instructor',$3,$3)",
        [courseId, pageUser, timestamp],
      );
    }

    const first = await service.listPage(pageUser, "active", 2);
    expect(first.data.map(({ id }) => id)).toEqual(
      [...courseIds].reverse().slice(0, 2),
    );
    expect(first.page).toMatchObject({ hasMore: true });
    const second = await service.listPage(
      pageUser,
      "active",
      2,
      first.page.nextCursor!,
    );
    expect(second.data.map(({ id }) => id)).toEqual([courseIds[0]]);
    expect(second.page).toEqual({ hasMore: false, nextCursor: null });
    await expect(
      service.listPage(pageUser, "active", 2, "not-a-cursor"),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      service.listPage(pageUser, "archived", 2, first.page.nextCursor!),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("paginates organization courses and course members without duplicate timestamp rows", async () => {
    const pageOrganization = "66666666-6666-4666-8666-666666666666";
    const pageOwner = "66666666-6666-4666-8666-666666666667";
    const courseIds = [
      "66666666-6666-4666-8666-666666666661",
      "66666666-6666-4666-8666-666666666662",
      "66666666-6666-4666-8666-666666666663",
    ];
    const memberIds = [
      "77777777-7777-4777-8777-777777777771",
      "77777777-7777-4777-8777-777777777772",
      "77777777-7777-4777-8777-777777777773",
    ];
    const timestamp = "2026-09-02T12:00:00.000Z";
    await pool.query(
      "INSERT INTO organizations (id,domain,name) VALUES ($1,'pages.example.edu','Pages')",
      [pageOrganization],
    );
    await pool.query(
      "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,'page-owner@pages.example.edu','Page owner','x')",
      [pageOwner, pageOrganization],
    );
    for (const [index, courseId] of courseIds.entries()) {
      await pool.query(
        "INSERT INTO courses (id,organization_id,created_by_user_id,name,join_code,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
        [
          courseId,
          pageOrganization,
          pageOwner,
          `Organization page ${index}`,
          `ORGA${index}ABC`,
          timestamp,
        ],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role,created_at,updated_at) VALUES ($1,$2,'instructor',$3,$3)",
        [courseId, pageOwner, timestamp],
      );
    }
    for (const [index, memberId] of memberIds.entries()) {
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [
          memberId,
          pageOrganization,
          `member-${index}@pages.example.edu`,
          `Member ${index}`,
        ],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role,created_at,updated_at) VALUES ($1,$2,'student',$3,$3)",
        [courseIds[0], memberId, timestamp],
      );
    }

    const organizationFirst = await service.listOrganizationPage(
      pageOrganization,
      pageOwner,
      "active",
      2,
    );
    expect(organizationFirst.data.map(({ id }) => id)).toEqual(
      [...courseIds].reverse().slice(0, 2),
    );
    const organizationSecond = await service.listOrganizationPage(
      pageOrganization,
      pageOwner,
      "active",
      2,
      organizationFirst.page.nextCursor!,
    );
    expect(organizationSecond.data.map(({ id }) => id)).toEqual([courseIds[0]]);

    const membersFirst = await service.membersPage(
      courseIds[0],
      pageOwner,
      "student",
      2,
    );
    expect(membersFirst.data.map(({ user }) => user.id)).toEqual(
      [...memberIds].reverse().slice(0, 2),
    );
    const membersSecond = await service.membersPage(
      courseIds[0],
      pageOwner,
      "student",
      2,
      membersFirst.page.nextCursor!,
    );
    expect(membersSecond.data.map(({ user }) => user.id)).toEqual([
      memberIds[0],
    ]);
    await expect(
      service.membersPage(
        courseIds[0],
        pageOwner,
        "ta",
        2,
        membersFirst.page.nextCursor!,
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("rejects a valid cursor reused against another operation or collection", async () => {
    const first = await service.create(
      organization,
      owner,
      "Cursor scope first",
    );
    const second = await service.create(
      organization,
      owner,
      "Cursor scope second",
    );
    await service.join(first.id, guest, first.joinCode!);
    await service.join(second.id, guest, second.joinCode!);

    const userCursor = (await service.listPage(owner, undefined, 1)).page
      .nextCursor!;
    const organizationCursor = (
      await service.listOrganizationPage(organization, owner, undefined, 1)
    ).page.nextCursor!;
    const memberCursor = (
      await service.membersPage(first.id, owner, undefined, 1)
    ).page.nextCursor!;
    expect(userCursor).toBeTruthy();
    expect(organizationCursor).toBeTruthy();
    expect(memberCursor).toBeTruthy();

    await expect(
      service.listPage(guest, undefined, 1, userCursor),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      service.listOrganizationPage(
        guestOrganization,
        guest,
        undefined,
        1,
        organizationCursor,
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      service.membersPage(second.id, owner, undefined, 1, memberCursor),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      service.listOrganizationPage(
        organization,
        owner,
        undefined,
        1,
        userCursor,
      ),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    await expect(
      service.listPage(owner, undefined, 1, memberCursor),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
  it("retrieves a member beyond the first list page", async () => {
    const course = await service.create(organization, owner, "Large lecture");
    const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    for (let index = 0; index < 26; index += 1) {
      const id =
        index === 25
          ? targetId
          : `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`;
      await pool.query(
        "INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,'x')",
        [id, organization, `large-${index}@example.edu`, `Large ${index}`],
      );
      await pool.query(
        "INSERT INTO course_memberships (course_id,user_id,role) VALUES ($1,$2,'student')",
        [course.id, id],
      );
    }
    const direct = service as unknown as {
      getMember: (
        courseId: string,
        actorId: string,
        targetId: string,
      ) => Promise<{ user: { id: string } }>;
    };
    await expect(direct.getMember(course.id, owner, targetId)).resolves.toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ id: targetId }),
      }),
    );
  });
  it("rejects edits and self-leave while deletion is in progress", async () => {
    const course = await service.create(organization, owner, "Deleting course");
    await service.join(course.id, guest, course.joinCode!);
    const deleting = await service.delete(course.id, owner, courseEtag(course));
    await expect(
      service.update(course.id, owner, courseEtag(deleting), { name: "Later" }),
    ).rejects.toMatchObject({ status: 409, code: "course_deleting" });
    await expect(
      service.removeMember(course.id, guest, guest, undefined, true),
    ).rejects.toMatchObject({ status: 409, code: "course_deleting" });
  });
  it("enforces course and membership preconditions and archived join rules", async () => {
    const course = await service.create(organization, owner, "Preconditions");
    const guestMembership = await service.join(
      course.id,
      guest,
      course.joinCode!,
    );
    await expect(
      service.update(course.id, owner, undefined, { name: "Next" }),
    ).rejects.toMatchObject({
      status: 428,
      code: "precondition_required",
    });
    await expect(
      service.update(course.id, owner, '"v99"', { name: "Next" }),
    ).rejects.toMatchObject({
      status: 412,
      code: "version_conflict",
    });
    await expect(
      service.updateMember(course.id, owner, guest, undefined, "ta"),
    ).rejects.toMatchObject({ status: 428, code: "precondition_required" });
    await expect(
      service.updateMember(course.id, owner, guest, '"v99"', "ta"),
    ).rejects.toMatchObject({ status: 412, code: "version_conflict" });
    await expect(
      service.removeMember(course.id, owner, guest, undefined),
    ).rejects.toMatchObject({ status: 428, code: "precondition_required" });
    await expect(
      service.removeMember(course.id, owner, guest, '"v99"'),
    ).rejects.toMatchObject({ status: 412, code: "version_conflict" });
    await expect(
      service.updateMember(
        course.id,
        owner,
        owner,
        courseEtag({ version: 1 }),
        "student",
      ),
    ).rejects.toMatchObject({ status: 409, code: "last_instructor" });
    const archived = await service.update(
      course.id,
      owner,
      courseEtag(course),
      {
        status: "archived",
      },
    );
    await expect(
      service.join(course.id, guest, archived.joinCode!),
    ).rejects.toMatchObject({
      status: 409,
      code: "course_archived",
    });
    expect(guestMembership.role).toBe("student");
  });
  it("does not reveal whether a course exists when a signed-in user joins", async () => {
    await expect(
      service.join("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", guest, "ABCDEFGH"),
    ).rejects.toMatchObject({ status: 422, code: "invalid_join_code" });
    await expect(
      service.join("not-a-uuid", guest, "ABCDEFGH"),
    ).rejects.toMatchObject({ status: 422, code: "invalid_join_code" });
  });
  it("does not reveal archived status to a caller without the join code", async () => {
    const created = await service.create(
      organization,
      owner,
      "Private archive",
    );
    await service.update(created.id, owner, courseEtag(created), {
      status: "archived",
    });
    await expect(
      service.join(created.id, guest, "AAAAAAAA"),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_join_code",
    });
    await expect(
      service.joinIdempotently(
        created.id,
        guest,
        "AAAAAAAA",
        "private-archive-key",
        { joinCode: "AAAAAAAA" },
      ),
    ).rejects.toMatchObject({ status: 422, code: "invalid_join_code" });
  });
});
