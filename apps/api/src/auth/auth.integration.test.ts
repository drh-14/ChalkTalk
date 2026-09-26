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
import { SESSION_COOKIE_NAME } from "./crypto.js";
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

class BlockingEmailSender implements EmailSender {
  readonly messages: SentEmail[] = [];
  private releaseFirstDelivery!: () => void;
  private readonly firstDeliveryReleased = new Promise<void>((resolve) => {
    this.releaseFirstDelivery = resolve;
  });
  private resolveFirstDeliveryStarted!: () => void;
  readonly firstDeliveryStarted = new Promise<void>((resolve) => {
    this.resolveFirstDeliveryStarted = resolve;
  });
  private resolveSecondDeliveryStarted!: () => void;
  readonly secondDeliveryStarted = new Promise<void>((resolve) => {
    this.resolveSecondDeliveryStarted = resolve;
  });

  async send(message: SentEmail): Promise<void> {
    this.messages.push(message);
    if (this.messages.length === 1) {
      this.resolveFirstDeliveryStarted();
      await this.firstDeliveryReleased;
      return;
    }
    this.resolveSecondDeliveryStarted();
  }

  release(): void {
    this.releaseFirstDelivery();
  }
}

class FailingEmailSender implements EmailSender {
  async send(): Promise<void> {
    throw new Error("SMTP is unavailable");
  }
}

class NeverResolvingEmailSender implements EmailSender {
  calls = 0;
  aborted = 0;

  async send(
    _message: SentEmail,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<void> {
    this.calls += 1;
    return new Promise((resolve) => {
      signal?.addEventListener(
        "abort",
        () => {
          this.aborted += 1;
          resolve();
        },
        { once: true },
      );
    });
  }
}

class FakeResetTiming {
  currentTime = 0;
  readonly sleeps: number[] = [];

  now = (): number => this.currentTime;

  sleep = async (milliseconds: number): Promise<void> => {
    this.sleeps.push(milliseconds);
    this.currentTime += milliseconds;
  };
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

async function waitForBlockedUserUpdates(
  queryFragment: string,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await adminPool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND query LIKE $1
         AND wait_event_type = 'Lock'`,
      [`%${queryFragment}%`],
    );
    if (Number(result.rows[0]!.count) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("User updates did not both block on the user row");
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

async function resolvesWithin(
  promise: Promise<unknown>,
  milliseconds: number,
): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), milliseconds),
    ),
  ]);
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
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe("verification_token_used");

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

  it("returns 202 for known and unknown password-reset requests when SMTP fails", async () => {
    await createVerifiedUser("reset-known@example.edu");
    const app = createApp({
      environment,
      authService: new AuthService(pool, environment, new FailingEmailSender()),
    });

    const known = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "reset-known@example.edu" });
    const unknown = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "reset-unknown@example.edu" });

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
  });

  it("enforces configured verification, login, reset, and signup limits with Retry-After", async () => {
    const limitedEnvironment: Environment = {
      ...environment,
      authTokenSecret:
        "a-different-secret-that-is-longer-than-thirty-two-characters",
      rateLimits: {
        verificationPerEmail: 1,
        verificationPerIp: 100,
        loginPerEmail: 1,
        loginPerIp: 100,
        resetPerEmail: 1,
        resetPerIp: 100,
        signupPerIp: 1,
      },
    };
    const limitedService = new AuthService(
      pool,
      limitedEnvironment,
      emailSender,
    );
    const app = createApp({
      environment: limitedEnvironment,
      authService: limitedService,
    });
    const origin = limitedEnvironment.frontendBaseUrl;

    const firstVerification = await request(app)
      .post("/api/v1/account-verification-requests")
      .set("Origin", origin)
      .send({ email: "limited-verification@example.edu" });
    const limitedVerification = await request(app)
      .post("/api/v1/account-verification-requests")
      .set("Origin", origin)
      .send({ email: "limited-verification@example.edu" });

    const user = await createVerifiedUser("limited-login@example.edu");
    const firstLogin = await request(app)
      .post("/api/v1/sessions")
      .set("Origin", origin)
      .send({ email: user.email, password: "correct horse battery staple" });
    const limitedLogin = await request(app)
      .post("/api/v1/sessions")
      .set("Origin", origin)
      .send({ email: user.email, password: "correct horse battery staple" });

    const firstReset = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", origin)
      .send({ email: user.email });
    const limitedReset = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", origin)
      .send({ email: user.email });

    await limitedService.requestVerification("limited-signup-one@example.edu");
    const firstSignup = await request(app)
      .post("/api/v1/users")
      .set("Origin", origin)
      .send({
        verificationToken: tokenFrom(emailSender.messages.at(-1)!),
        password: "correct horse battery staple",
        displayName: "Limited Signup One",
      });
    await limitedService.requestVerification("limited-signup-two@example.edu");
    const limitedSignup = await request(app)
      .post("/api/v1/users")
      .set("Origin", origin)
      .send({
        verificationToken: tokenFrom(emailSender.messages.at(-1)!),
        password: "correct horse battery staple",
        displayName: "Limited Signup Two",
      });

    expect(firstVerification.status).toBe(202);
    expect(firstLogin.status).toBe(201);
    expect(firstReset.status).toBe(202);
    expect(firstSignup.status).toBe(201);
    for (const response of [
      limitedVerification,
      limitedLogin,
      limitedReset,
      limitedSignup,
    ]) {
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe("rate_limited");
      expect(response.headers["retry-after"]).toMatch(/^[1-9]\d*$/);
    }
  }, 10_000);

  it("applies the reset response floor while bounding known-user SMTP delivery", async () => {
    const known = await createVerifiedUser("paced-known@example.edu");
    const knownTiming = new FakeResetTiming();
    const unknownTiming = new FakeResetTiming();
    const neverResolvingSender = new NeverResolvingEmailSender();
    const knownService = new AuthService(
      pool,
      environment,
      neverResolvingSender,
      knownTiming,
    );
    const unknownService = new AuthService(
      pool,
      environment,
      neverResolvingSender,
      unknownTiming,
    );

    await knownService.requestPasswordReset(known.email);
    await unknownService.requestPasswordReset("paced-unknown@example.edu");

    expect(knownTiming.sleeps).toEqual([750, 250]);
    expect(unknownTiming.sleeps).toEqual([1000]);
    expect(knownTiming.currentTime).toBe(1000);
    expect(unknownTiming.currentTime).toBe(1000);
    expect(neverResolvingSender.calls).toBe(1);
    expect(neverResolvingSender.aborted).toBe(1);
  });

  it("atomically replays concurrent account creation with the same idempotency key", async () => {
    const app = createApp({ environment, authService: service });
    await service.requestVerification("idempotent-signup@example.edu");
    const body = {
      verificationToken: tokenFrom(emailSender.messages.at(-1)!),
      password: "correct horse battery staple",
      displayName: "Idempotent Ada",
    };

    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        request(app)
          .post("/api/v1/users")
          .set("Origin", environment.frontendBaseUrl)
          .set("Idempotency-Key", "concurrent-signup")
          .send(body),
      ),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
    expect(first.headers.location).toBe("/api/v1/users/me");
    expect(second.headers.location).toBe(first.headers.location);
    expect(first.headers.etag).toBe(userEtag(first.body.data));
    expect(second.headers.etag).toBe(first.headers.etag);
    const created = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE email = $1",
      ["idempotent-signup@example.edu"],
    );
    expect(created.rows[0]!.count).toBe("1");

    const conflict = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .set("Idempotency-Key", "concurrent-signup")
      .send({ ...body, displayName: "Different request" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_key_reused");
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

  it("reports consumed verification tokens as used during an email change", async () => {
    const user = await createVerifiedUser("email-change@example.edu");
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    await service.requestVerification("renamed@example.edu");
    const token = tokenFrom(emailSender.messages.at(-1)!);
    const updated = await service.updateProfile(
      login.credential,
      userEtag(login.session.user),
      { emailVerificationToken: token },
    );

    expect(updated.email).toBe("renamed@example.edu");
    await expect(
      service.updateProfile(login.credential, userEtag(updated), {
        emailVerificationToken: token,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "verification_token_used",
    });
  });

  it("enforces profile email-change ETags and rejects a verified cross-school replacement", async () => {
    const emailChangeEnvironment = loadEnvironment({
      AUTH_TOKEN_SECRET: environment.authTokenSecret,
      ALLOWED_SCHOOL_DOMAINS: "example.edu,other.edu",
      FRONTEND_ORIGINS: environment.frontendBaseUrl,
      FRONTEND_BASE_URL: environment.frontendBaseUrl,
    });
    const emailChangeService = new AuthService(
      pool,
      emailChangeEnvironment,
      emailSender,
    );
    const app = createApp({
      environment: emailChangeEnvironment,
      authService: emailChangeService,
    });
    const user = await createVerifiedUser("http-email-change@example.edu");
    const login = await emailChangeService.login(
      user.email,
      "correct horse battery staple",
    );
    const headers = {
      Origin: emailChangeEnvironment.frontendBaseUrl,
      Cookie: `${SESSION_COOKIE_NAME}=${login.credential}`,
      "X-CSRF-Token": login.session.csrfToken,
      "If-Match": userEtag(login.session.user),
    };

    await emailChangeService.requestVerification("renamed-http@example.edu");
    const renamed = await request(app)
      .patch("/api/v1/users/me")
      .set(headers)
      .send({
        emailVerificationToken: tokenFrom(emailSender.messages.at(-1)!),
      });
    const stale = await request(app)
      .patch("/api/v1/users/me")
      .set(headers)
      .send({ displayName: "Stale Ada" });

    await emailChangeService.requestVerification("cross-school@other.edu");
    const crossSchool = await request(app)
      .patch("/api/v1/users/me")
      .set({ ...headers, "If-Match": renamed.headers.etag as string })
      .send({
        emailVerificationToken: tokenFrom(emailSender.messages.at(-1)!),
      });

    expect(renamed.status).toBe(200);
    expect(renamed.headers.etag).toBe(userEtag(renamed.body.data));
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe("version_conflict");
    expect(crossSchool.status).toBe(422);
    expect(crossSchool.body.error.code).toBe("email_domain_not_allowed");
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
      await waitForBlockedUserUpdates("UPDATE users SET email = $1", 2);
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

  it("allows only one concurrent password change for the same ETag and preserves only its session", async () => {
    const user = await createVerifiedUser("password-race@example.edu");
    const firstLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const secondLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const etag = userEtag(firstLogin.session.user);
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
      const changes = [
        firstService.changePassword(
          firstLogin.credential,
          etag,
          "correct horse battery staple",
          "a concurrent new password",
        ),
        secondService.changePassword(
          secondLogin.credential,
          etag,
          "correct horse battery staple",
          "a concurrent new password",
        ),
      ];
      await waitForBlockedUserUpdates("UPDATE users SET password_hash = $1", 2);
      await locker.query("COMMIT");

      const results = await Promise.allSettled(changes);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )[0]!.reason,
      ).toMatchObject({ status: 412, code: "version_conflict" });

      await expect(
        service.login(user.email, "a concurrent new password"),
      ).resolves.toBeDefined();
      const sessions = await pool.query<{
        id: string;
        revoked_at: Date | null;
      }>("SELECT id, revoked_at FROM sessions WHERE id = ANY($1)", [
        [firstLogin.session.id, secondLogin.session.id],
      ]);
      expect(
        sessions.rows.filter((session) => !session.revoked_at),
      ).toHaveLength(1);
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

    await expect(
      service.changePassword(
        firstLogin.credential,
        userEtag(firstLogin.session.user),
        undefined,
        "a new correct horse battery staple",
      ),
    ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });

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
      service.resetPassword(
        tokenFrom(emailSender.messages.at(-1)!),
        "one more correct horse battery staple",
      ),
    ).rejects.toMatchObject({ status: 409, code: "reset_token_used" });

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

    const deleted = await pool.query<{
      deleted_at: Date | null;
      email: string;
      display_name: string;
    }>("SELECT deleted_at, email, display_name FROM users WHERE id = $1", [
      instructor.id,
    ]);
    expect(deleted.rows[0]!.deleted_at).toBeInstanceOf(Date);
    expect(deleted.rows[0]!.email).toBe(
      `deleted+${instructor.id}@invalid.local`,
    );
    expect(deleted.rows[0]!.display_name).toBe("Deleted user");
    const memberships = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM course_memberships WHERE user_id = $1",
      [instructor.id],
    );
    expect(memberships.rows[0]!.count).toBe("0");
    await expect(service.session(login.credential)).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });

    const replacementLogin = await service.login(
      replacement.email,
      "correct horse battery staple",
    );
    await expect(
      service.deleteAccount(
        replacementLogin.credential,
        userEtag(replacementLogin.session.user),
        "correct horse battery staple",
      ),
    ).rejects.toMatchObject({ status: 409, code: "last_instructor" });
  }, 20_000);

  it("allows only one concurrent account deletion for the same ETag and revokes every session", async () => {
    const user = await createVerifiedUser("deletion-race@example.edu");
    const firstLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const secondLogin = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const etag = userEtag(firstLogin.session.user);
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
      const deletions = [
        firstService.deleteAccount(
          firstLogin.credential,
          etag,
          "correct horse battery staple",
        ),
        secondService.deleteAccount(
          secondLogin.credential,
          etag,
          "correct horse battery staple",
        ),
      ];
      await waitForBlockedUserUpdates(
        "SELECT password_hash FROM users WHERE id = $1 AND version = $2 FOR UPDATE",
        2,
      );
      await locker.query("COMMIT");

      const results = await Promise.allSettled(deletions);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )[0]!.reason,
      ).toMatchObject({ status: 412, code: "version_conflict" });

      const deleted = await pool.query<{ deleted_at: Date | null }>(
        "SELECT deleted_at FROM users WHERE id = $1",
        [user.id],
      );
      expect(deleted.rows[0]!.deleted_at).toBeInstanceOf(Date);
      await expect(
        service.session(firstLogin.credential),
      ).rejects.toMatchObject({
        status: 401,
        code: "authentication_required",
      });
      await expect(
        service.session(secondLogin.credential),
      ).rejects.toMatchObject({
        status: 401,
        code: "authentication_required",
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await Promise.all([firstPool.end(), secondPool.end(), lockPool.end()]);
    }
  }, 20_000);

  it("replays concurrent matching verification requests without duplicate mail and preserves a usable token", async () => {
    const sender = new BlockingEmailSender();
    const verificationService = new AuthService(pool, environment, sender);
    const app = createApp({ environment, authService: verificationService });
    const body = { email: "concurrent-verification@example.edu" };
    const headers = {
      Origin: environment.frontendBaseUrl,
      "Idempotency-Key": "concurrent-verification",
    };

    const first = request(app)
      .post("/api/v1/account-verification-requests")
      .set(headers)
      .send(body)
      .then((response) => response);
    await sender.firstDeliveryStarted;

    const second = request(app)
      .post("/api/v1/account-verification-requests")
      .set(headers)
      .send(body)
      .then((response) => response);
    const duplicateDeliveryStarted = await resolvesWithin(
      sender.secondDeliveryStarted,
      300,
    );
    sender.release();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(duplicateDeliveryStarted).toBe(false);
    expect([firstResponse.status, secondResponse.status]).toEqual([202, 202]);
    expect(sender.messages).toHaveLength(1);

    const creation = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        verificationToken: tokenFrom(sender.messages[0]!),
        password: "correct horse battery staple",
        displayName: "Concurrent Verification",
      });
    expect(creation.status).toBe(201);
  }, 20_000);

  it("returns invalid_request for malformed password-reset request bodies", async () => {
    const app = createApp({ environment, authService: service });
    const malformedEmail = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "not an email" });
    const unknownProperty = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "reset-shape@example.edu", unexpected: true });

    expect(
      [malformedEmail, unknownProperty].map((response) => ({
        status: response.status,
        code: response.body.error?.code,
      })),
    ).toEqual([
      { status: 400, code: "invalid_request" },
      { status: 422, code: "validation_failed" },
    ]);
  });

  it("holds known and unknown password-reset responses for at least 950 milliseconds", async () => {
    const known = await createVerifiedUser("timed-reset-known@example.edu");
    const app = createApp({ environment, authService: service });

    const knownStartedAt = performance.now();
    const knownResponse = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: known.email });
    const knownElapsed = performance.now() - knownStartedAt;

    const unknownStartedAt = performance.now();
    const unknownResponse = await request(app)
      .post("/api/v1/password-reset-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "timed-reset-unknown@example.edu" });
    const unknownElapsed = performance.now() - unknownStartedAt;

    expect(knownResponse.status).toBe(202);
    expect(unknownResponse.status).toBe(202);
    expect(knownElapsed).toBeGreaterThanOrEqual(950);
    expect(unknownElapsed).toBeGreaterThanOrEqual(950);
  }, 10_000);

  it("rejects unknown properties with validation_failed across account, session, and profile requests", async () => {
    const app = createApp({ environment, authService: service });
    const verification = await request(app)
      .post("/api/v1/account-verification-requests")
      .set("Origin", environment.frontendBaseUrl)
      .send({ email: "unknown-verification@example.edu", unexpected: true });

    await service.requestVerification("unknown-signup@example.edu");
    const signup = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        verificationToken: tokenFrom(emailSender.messages.at(-1)!),
        password: "correct horse battery staple",
        displayName: "Unknown Signup",
        unexpected: true,
      });

    const sessionUser = await createVerifiedUser("unknown-session@example.edu");
    const session = await request(app)
      .post("/api/v1/sessions")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        email: sessionUser.email,
        password: "correct horse battery staple",
        unexpected: true,
      });

    const profileUser = await createVerifiedUser("unknown-profile@example.edu");
    const profileLogin = await service.login(
      profileUser.email,
      "correct horse battery staple",
    );
    const profile = await request(app)
      .patch("/api/v1/users/me")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=${profileLogin.credential}`)
      .set("X-CSRF-Token", profileLogin.session.csrfToken)
      .set("If-Match", userEtag(profileLogin.session.user))
      .send({ displayName: "Updated name", unexpected: true });

    expect(
      [verification, signup, session, profile].map((response) => ({
        status: response.status,
        code: response.body.error?.code,
      })),
    ).toEqual([
      { status: 422, code: "validation_failed" },
      { status: 422, code: "validation_failed" },
      { status: 422, code: "validation_failed" },
      { status: 422, code: "validation_failed" },
    ]);
  });

  it("rejects display names longer than 100 characters during signup without creating an account", async () => {
    const email = "signup-display-limit@example.edu";
    const app = createApp({ environment, authService: service });
    await service.requestVerification(email);
    const response = await request(app)
      .post("/api/v1/users")
      .set("Origin", environment.frontendBaseUrl)
      .send({
        verificationToken: tokenFrom(emailSender.messages.at(-1)!),
        password: "correct horse battery staple",
        displayName: "a".repeat(101),
      });
    const users = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users WHERE email = $1",
      [email],
    );

    expect({
      status: response.status,
      code: response.body.error?.code,
      users: users.rows[0]!.count,
    }).toEqual({
      status: 422,
      code: "validation_failed",
      users: "0",
    });
  });

  it("rejects display names longer than 100 characters during profile updates without mutation", async () => {
    const user = await createVerifiedUser("profile-display-limit@example.edu");
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const app = createApp({ environment, authService: service });
    const response = await request(app)
      .patch("/api/v1/users/me")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=${login.credential}`)
      .set("X-CSRF-Token", login.session.csrfToken)
      .set("If-Match", userEtag(login.session.user))
      .send({ displayName: "a".repeat(101) });
    const stored = await service.profile(login.credential);

    expect({
      status: response.status,
      code: response.body.error?.code,
      displayName: stored.displayName,
    }).toEqual({
      status: 422,
      code: "validation_failed",
      displayName: "Ada Lovelace",
    });
  });

  it("rejects overlong current passwords during password changes without mutation", async () => {
    const user = await createVerifiedUser(
      "change-current-password-limit@example.edu",
    );
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const app = createApp({ environment, authService: service });
    const response = await request(app)
      .patch("/api/v1/users/me/password")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=${login.credential}`)
      .set("X-CSRF-Token", login.session.csrfToken)
      .set("If-Match", userEtag(login.session.user))
      .send({
        currentPassword: "a".repeat(129),
        newPassword: "a new correct horse battery staple",
      });
    const stillAuthenticates = await service.login(
      user.email,
      "correct horse battery staple",
    );

    expect({
      status: response.status,
      code: response.body.error?.code,
      session: stillAuthenticates.session.id,
    }).toEqual({
      status: 422,
      code: "validation_failed",
      session: expect.any(String),
    });
  });

  it("rejects overlong current passwords during account deletion without mutation", async () => {
    const user = await createVerifiedUser(
      "delete-current-password-limit@example.edu",
    );
    const login = await service.login(
      user.email,
      "correct horse battery staple",
    );
    const app = createApp({ environment, authService: service });
    const response = await request(app)
      .delete("/api/v1/users/me")
      .set("Origin", environment.frontendBaseUrl)
      .set("Cookie", `${SESSION_COOKIE_NAME}=${login.credential}`)
      .set("X-CSRF-Token", login.session.csrfToken)
      .set("If-Match", userEtag(login.session.user))
      .send({ currentPassword: "a".repeat(129) });
    const stored = await pool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM users WHERE id = $1",
      [user.id],
    );
    const session = await service.session(login.credential);

    expect({
      status: response.status,
      code: response.body.error?.code,
      deletedAt: stored.rows[0]!.deleted_at,
      session: session.id,
    }).toEqual({
      status: 422,
      code: "validation_failed",
      deletedAt: null,
      session: login.session.id,
    });
  });
});
