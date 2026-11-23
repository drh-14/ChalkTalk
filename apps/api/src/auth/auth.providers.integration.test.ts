import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { createApp } from "../http/app.js";
import { getMigrationDirectory, runMigrations } from "../database/migrate.js";
import { AuthService, type EmailSender } from "./service.js";
import { createEmailSender } from "./email.js";
const transports = vi.hoisted(() => ({ resend: vi.fn(), ses: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: transports.resend };
  },
}));
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    send = transports.ses;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));
const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const schema = `auth_providers_${process.pid}_${Date.now()}`;
let admin: Pool;
let pool: Pool;
integration("HTTPS providers preserve the public auth contract", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    await runMigrations(pool, getMigrationDirectory());
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
  });
  for (const provider of ["resend", "sendgrid", "ses"] as const)
    it(`${provider} verifies and resets immediately with unchanged statuses and no durable jobs`, async () => {
      transports.resend.mockResolvedValue({
        data: { id: "accepted" },
        error: null,
      });
      transports.ses.mockResolvedValue({ MessageId: "accepted" });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
      );
      const environment = loadEnvironment({
        AUTH_TOKEN_SECRET: "synthetic-secret-at-least-32-characters",
        FRONTEND_ORIGINS: "https://app.example.test",
        FRONTEND_BASE_URL: "https://app.example.test",
        EMAIL_PROVIDER: provider,
        EMAIL_FROM: "ChalkTalk <mail@example.test>",
        ...(provider === "resend"
          ? { RESEND_API_KEY: "synthetic" }
          : provider === "sendgrid"
            ? { SENDGRID_API_KEY: "synthetic" }
            : {
                SES_REGION: "us-east-1",
                SES_CREDENTIALS_MODE: "explicit",
                SES_ACCESS_KEY_ID: "synthetic",
                SES_SECRET_ACCESS_KEY: "synthetic",
              }),
      });
      const messages: Array<Parameters<EmailSender["send"]>[0]> = [];
      const adapter = createEmailSender(environment);
      const sender: EmailSender = {
        ...adapter,
        send: async (message, options) => {
          messages.push(message);
          await adapter.send(message, options);
        },
      };
      const service = new AuthService(pool, environment, sender);
      const app = createApp({ environment, authService: service });
      const email = `${provider}@auth-provider.example.test`;
      const denied = await request(app)
        .post("/api/v1/account-verification-requests")
        .set("Origin", "https://unapproved.example.test")
        .send({ email });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("origin_not_allowed");
      expect(messages).toHaveLength(0);
      const invalid = await request(app)
        .post("/api/v1/account-verification-requests")
        .set("Origin", environment.frontendBaseUrl)
        .send({ email: "bad..address@example.test" });
      expect(invalid.status).toBe(422);
      expect(messages).toHaveLength(0);
      const verified = await request(app)
        .post("/api/v1/account-verification-requests")
        .set("Origin", environment.frontendBaseUrl)
        .send({ email });
      expect(verified.status).toBe(202);
      expect(verified.headers["set-cookie"]).toBeUndefined();
      expect(messages).toHaveLength(1);
      expect(messages[0].to).toBe(email);
      expect(messages[0].text).toContain("https://app.example.test/");
      const link = new URL(messages[0].text.match(/https:\/\/\S+/)![0]);
      const created = await request(app)
        .post("/api/v1/users")
        .set("Origin", environment.frontendBaseUrl)
        .send({
          verificationToken: link.searchParams.get("token"),
          password: "correct horse battery staple",
          displayName: "Synthetic User",
        });
      expect(created.status).toBe(201);
      const reset = await request(app)
        .post("/api/v1/password-reset-requests")
        .set("Origin", environment.frontendBaseUrl)
        .send({ email });
      expect(reset.status).toBe(202);
      expect(messages).toHaveLength(2);
      expect(messages[1].to).toBe(email);
      expect(messages[1].text).toContain("https://app.example.test/");
      expect(
        (await pool.query("SELECT count(*) FROM jobs WHERE kind LIKE 'send_%'"))
          .rows[0].count,
      ).toBe("0");
    }, 15_000);
});
