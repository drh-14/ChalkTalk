import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type PromiseRejectedResult,
} from "vitest";
import { createApp } from "../http/app.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { AuthService, type EmailSender, userEtag } from "./service.js";
import { loadEnvironment, type Environment } from "../config/environment.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = testDatabaseUrl ? describe : describe.skip;
const schemaName = `auth_integration_${process.pid}_${Date.now()}`;

interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

class RecordingEmailSender implements EmailSender {
  readonly messages: SentEmail[] = [];

  async send(message: SentEmail): Promise<void> {
    this.messages.push(message);
  }
}

let adminPool: Pool;
let pool: Pool;
let environment: Environment;
let emailSender: RecordingEmailSender;
let service: AuthService;

function schemaIdentifier(): string {
  return `"${schemaName}"`;
}

async function schemaPool(): Promise<Pool> {
  const isolatedPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  await isolatedPool.query(`SET search_path TO ${schemaIdentifier()}`);
  return isolatedPool;
}

function tokenFrom(message: SentEmail): string {
  const url = new URL(message.text.match(/https?:\/\/\S+/)?.[0] ?? "");
  const token = url.searchParams.get("token");
  if (!token) throw new Error("Email did not contain a token");
  return token;
}

async function createVerifiedUser(email: string) {
  await service.requestVerification(email);
  return service.createUser({
    verificationToken: tokenFrom(emailSender.messages.at(-1)!),
    password: "correct horse battery staple",
    displayName: "Ada Lovelace",
  });
}

async function waitForBlockedProfileUpdates(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND query LIKE '%UPDATE users SET email = $1%'
         AND wait_event_type = 'Lock'`,
    );
    if (Number(result.rows[0]!.count) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Profile updates did not both block on the user row");
}

async function waitForBlockedCourseLock(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND query LIKE '%SELECT c.id FROM courses c JOIN course_memberships cm%'
         AND wait_event_type = 'Lock'`,
    );
    if (Number(result.rows[0]!.count) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Account deletion did not lock its instructor courses");
}

integrationTest("AuthService PostgreSQL integration", () => {
  beforeAll(async () => {
    adminPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
    await adminPool.query(`CREATE SCHEMA ${schemaIdentifier()}`);
    pool = await schemaPool();
    await runMigrations(pool, getMigrationDirectory());
    environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-secret-that-is-longer-than-thirty-two-characters",
      ALLOWED_SCHOOL_DOMAINS: "example.edu",
      FRONTEND_ORIGINS: "https://app.example.edu",
      FRONTEND_BASE_URL: "https://app.example.edu",
    });
    emailSender = new RecordingEmailSender();
    service = new AuthService(pool, environment, emailSender);
  });

  afterAll(async () => {
    await pool?.end();
    await adminPool?.query(
      `DROP SCHEMA IF EXISTS ${schemaIdentifier()} CASCADE`,
    );
    await adminPool?.end();
  });

  it("replays verification idempotently, consumes tokens once, and directly links users to organizations", async () => {
    const app = createApp({ environment, authService: service });
    const requestBody = { email: "ada@example.edu" };

    const first = await request(app)
      .post("/api/v1/account-verification-requests")
      .set("Origin", environment.frontendBaseUrl)
      .set("Idempotency-Key", "verification-ada")
      .send(requestBody);
    const replay = await request(app)
      .post("/api/v1/account-verification-requests")
      .set("Origin", environment.frontendBaseUrl)
      .set("Idempotency-Key", "verification-ada")
      .send(requestBody);

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(emailSender.messages).toHaveLength(1);

    const creation = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        verificationToken: tokenFrom(emailSender.messages[0]!),
        password: "correct horse battery staple",
        displayName: "Ada Lovelace",
      });
    const reuse = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        verificationToken: tokenFrom(emailSender.messages[0]!),
        password: "correct horse battery staple",
        displayName: "Ada Lovelace",
      });

    expect(creation.status).toBe(201);
    expect(reuse.status).toBe(422);
    expect(reuse.body.error.code).toBe("verification_token_invalid");

    const linkage = await pool.query<{
      organization_id: string;
      domain: string;
    }>(
      `SELECT u.organization_id, o.domain
       FROM users u JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = $1`,
      ["ada@example.edu"],
    );
    const memberships = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'organization_memberships') AS exists",
    );

    expect(linkage.rows).toEqual([
      { organization_id: expect.any(String), domain: "example.edu" },
    ]);
    expect(memberships.rows[0]!.exists).toBe(false);
  });

  it("rejects a sequential replay of a stale profile ETag", async () => {
    const user = await createVerifiedUser("replay@example.edu");
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const etag = userEtag(login.session.user);

    const updated = await service.updateProfile(login.credential, etag, {
      displayName: "Grace Hopper",
    });

    expect(updated.displayName).toBe("Grace Hopper");
    await expect(
      service.updateProfile(login.credential, etag, {
        displayName: "Rear Admiral Hopper",
      }),
    ).rejects.toMatchObject({ status: 412, code: "version_conflict" });
  });

  it("allows only one of two concurrent profile updates using the same ETag", async () => {
    const user = await createVerifiedUser("race@example.edu");
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const etag = userEtag(login.session.user);
    const firstPool = await schemaPool();
    const secondPool = await schemaPool();
    const firstService = new AuthService(firstPool, environment, emailSender);
    const secondService = new AuthService(secondPool, environment, emailSender);
    const lockPool = await schemaPool();
    const locker = await lockPool.connect();

    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [
        user.id,
      ]);

      const updates = [
        firstService.updateProfile(login.credential, etag, {
          displayName: "First concurrent update",
        }),
        secondService.updateProfile(login.credential, etag, {
          displayName: "Second concurrent update",
        }),
      ];
      await waitForBlockedProfileUpdates(2);
      await locker.query("COMMIT");

      const results = await Promise.allSettled(updates);
      const succeeded = results.filter(
        (result): result is PromiseFulfilledResult<unknown> =>
          result.status === "fulfilled",
      );
      const failed = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.reason).toMatchObject({
        status: 412,
        code: "version_conflict",
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await Promise.all([firstPool.end(), secondPool.end(), lockPool.end()]);
    }
  }, 20_000);

  it("revokes other sessions on password change and all sessions on password reset", async () => {
    const user = await createVerifiedUser("passwords@example.edu");
    const firstLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const secondLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );

    await service.changePassword(
      firstLogin.credential,
      userEtag(firstLogin.session.user),
      "correct horse battery staple",
      "a new correct horse battery staple",
    );

    await expect(service.session(firstLogin.credential)).resolves.toMatchObject(
      {
        id: firstLogin.session.id,
      },
    );
    await expect(service.session(secondLogin.credential)).rejects.toMatchObject(
      {
        status: 401,
        code: "authentication_required",
      },
    );

    const postChangeLogin = await service.login(
      user.email,
      "a new correct horse battery staple",
    );
    await service.requestPasswordReset(user.email);
    await service.resetPassword(
      tokenFrom(emailSender.messages.at(-1)!),
      "yet another correct horse battery staple",
    );

    await expect(
      service.session(postChangeLogin.credential),
    ).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  });

  it("locks instructor courses, rejects final instructors, and deletes when another instructor remains", async () => {
    const instructor = await createVerifiedUser("instructor@example.edu");
    const replacement = await createVerifiedUser("replacement@example.edu");
    const login = await service.login(
      instructor.email,
      "correct horse battery staple",
    );
    const courseId = randomUUID();
    const organization = await pool.query<{ organization_id: string }>(
      "SELECT organization_id FROM users WHERE id = $1",
      [instructor.id],
    );
    await pool.query(
      "INSERT INTO courses (id, organization_id, name) VALUES ($1, $2, $3)",
      [courseId, organization.rows[0]!.organization_id, "Compilers"],
    );
    await pool.query(
      "INSERT INTO course_memberships (course_id, user_id, role) VALUES ($1, $2, 'instructor')",
      [courseId, instructor.id],
    );

    const lockPool = await schemaPool();
    const locker: PoolClient = await lockPool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM courses WHERE id = $1 FOR UPDATE", [
        courseId,
      ]);
      const deletion = service.deleteAccount(
        login.credential,
        userEtag(login.session.user),
        "correct horse battery staple",
      );
      await waitForBlockedCourseLock();
      await locker.query("COMMIT");

      await expect(deletion).rejects.toMatchObject({
        status: 409,
        code: "last_instructor",
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await lockPool.end();
    }

    await pool.query(
      "INSERT INTO course_memberships (course_id, user_id, role) VALUES ($1, $2, 'instructor')",
      [courseId, replacement.id],
    );
    await service.deleteAccount(
      login.credential,
      userEtag(login.session.user),
      "correct horse battery staple",
    );

    const deleted = await pool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM users WHERE id = $1",
      [instructor.id],
    );
    expect(deleted.rows[0]!.deleted_at).toBeInstanceOf(Date);
    await expect(service.session(login.credential)).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
  }, 20_000);
});
