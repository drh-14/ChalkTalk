import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { RESEND_EMAIL_FROM } from "../config/constants.js";
import { createEmailSender } from "./email.js";

describe("configured Resend API endpoint", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    servers.length = 0;
  });

  it("sends through a local HTTPS-API mock with configured credentials", async () => {
    const requests: Array<{
      authorization: string | undefined;
      idempotencyKey: string | undefined;
      body: unknown;
    }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"] as
          string | undefined,
        body: JSON.parse(Buffer.concat(chunks).toString()),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: "email-local-1" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No mock port");
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-long-enough-authentication-secret-for-email-tests",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_local_secret",
      RESEND_API_BASE_URL: `http://127.0.0.1:${address.port}`,
    });
    await createEmailSender(environment).send(
      { to: "student@example.edu", subject: "Course update", text: "Hello" },
      { idempotencyKey: "job-local-1" },
    );
    expect(requests).toEqual([
      {
        authorization: "Bearer re_local_secret",
        idempotencyKey: "job-local-1",
        body: {
          from: RESEND_EMAIL_FROM,
          to: "student@example.edu",
          subject: "Course update",
          text: "Hello",
        },
      },
    ]);
  });
  it("retries after a connection drop with the same payload and idempotency key", async () => {
    const requests: Array<{ body: string; key: string | undefined }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        body: Buffer.concat(chunks).toString(),
        key: request.headers["idempotency-key"] as string | undefined,
      });
      if (requests.length === 1) request.socket.destroy();
      else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: "sent-after-retry" }));
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No mock port");
    const sender = createEmailSender(
      loadEnvironment({
        AUTH_TOKEN_SECRET:
          "a-long-enough-authentication-secret-for-email-tests",
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_local_secret",
        RESEND_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      }),
    );
    const message = await sender.prepare!({
      to: "student@example.edu",
      subject: "Retry",
      text: "Same body",
    });
    await expect(
      sender.send(message, { idempotencyKey: "job-local-2" }),
    ).rejects.toThrow();
    await sender.send(message, { idempotencyKey: "job-local-2" });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });
});
