import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { createEmailSender } from "./email.js";
const capture = vi.hoisted(() => ({
  requests: [] as Array<{
    authorization: string;
    body: unknown;
    hostname: string;
    protocol: string;
  }>,
}));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...sdk,
    SESv2Client: class extends sdk.SESv2Client {
      constructor(config: ConstructorParameters<typeof sdk.SESv2Client>[0]) {
        super({
          ...config,
          requestHandler: {
            handle: async (request: {
              headers: Record<string, string>;
              body: unknown;
              hostname: string;
              protocol: string;
            }) => {
              capture.requests.push({
                authorization: request.headers.authorization,
                hostname: request.hostname,
                protocol: request.protocol,
                body: request.body,
              });
              return {
                response: {
                  statusCode: 200,
                  headers: { "content-type": "application/json" },
                  body: Buffer.from('{"MessageId":"accepted"}'),
                },
              };
            },
          },
        });
      }
    },
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  capture.requests.length = 0;
});
it("refreshes a live container-local credential provider without changing frozen MIME or exporting secrets", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
  let key = "FIRST_SYNTHETIC_KEY";
  let resolutions = 0;
  const server = createServer((_request, response) => {
    resolutions++;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        AccessKeyId: key,
        SecretAccessKey: "synthetic-secret",
        Token: "synthetic-session",
        Expiration: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("fixture has no port");
    for (const name of [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
    ])
      vi.stubEnv(name, undefined);
    vi.stubEnv(
      "AWS_CONTAINER_CREDENTIALS_FULL_URI",
      `http://127.0.0.1:${address.port}/credentials`,
    );
    vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
    vi.stubEnv("AWS_ENDPOINT_URL", "http://unselected-mail-gateway.invalid");
    vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", "/nonexistent-explicit-fixture");
    vi.stubEnv("AWS_CONFIG_FILE", "/nonexistent-explicit-fixture");
    const sender = createEmailSender(
      loadEnvironment({
        AUTH_TOKEN_SECRET: "synthetic-secret-with-at-least-32-characters",
        EMAIL_PROVIDER: "ses",
        EMAIL_FROM: "mail@example.test",
        SES_REGION: "us-east-1",
        SES_CREDENTIALS_MODE: "default-chain",
      }),
    );
    const frozen = await sender.prepare!({
      to: "recipient@example.test",
      subject: "Synthetic",
      text: "Frozen content",
    });
    await sender.send(frozen);
    expect(capture.requests[0]).toMatchObject({
      hostname: "email.us-east-1.amazonaws.com",
      protocol: "https:",
    });
    expect(capture.requests[0].authorization).toContain("FIRST_SYNTHETIC_KEY");
    key = "SECOND_SYNTHETIC_KEY";
    vi.setSystemTime(new Date("2026-11-22T12:11:00Z"));
    await sender.send(frozen);
    expect(capture.requests[1].authorization).toContain("SECOND_SYNTHETIC_KEY");
    expect(capture.requests[1].body).toEqual(capture.requests[0].body);
    expect(resolutions).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(frozen)).not.toMatch(
      /SYNTHETIC_KEY|synthetic-secret|synthetic-session/,
    );
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
