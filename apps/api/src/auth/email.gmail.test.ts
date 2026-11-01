import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import {
  createEmailSender,
  EmailConfigurationError,
  GmailQuotaError,
  PermanentEmailDeliveryError,
} from "./email.js";

describe("Gmail HTTPS sender", () => {
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

  async function mockGoogle(
    statuses: Array<number | "malformed"> = [200],
    tokenStatus = 200,
  ) {
    const requests: Array<{
      path: string;
      authorization?: string;
      body: string;
    }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const path = request.url ?? "";
      requests.push({
        path,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      const outcome =
        path === "/token" ? tokenStatus : (statuses.shift() ?? 200);
      const status = outcome === "malformed" ? 200 : outcome;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          path === "/token"
            ? {
                access_token: "access-local",
                expires_in: 3600,
                token_type: "Bearer",
              }
            : outcome === "malformed"
              ? {}
              : status === 200
                ? { id: "sent-1" }
                : { error: { code: status, message: "provider rejected" } },
        ),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No mock port");
    const origin = `http://127.0.0.1:${address.port}`;
    const environment = loadEnvironment({
      AUTH_TOKEN_SECRET: "a-long-enough-authentication-secret-for-email-tests",
      EMAIL_PROVIDER: "gmail",
      EMAIL_FROM: "ChalkTalk <sender@gmail.com>",
      GMAIL_CLIENT_ID: "local-client",
      GMAIL_CLIENT_SECRET: "local-secret",
      GMAIL_REFRESH_TOKEN: "local-refresh",
      GMAIL_TOKEN_URL: `${origin}/token`,
      GMAIL_API_BASE_URL: origin,
    });
    return { requests, sender: createEmailSender(environment) };
  }

  it("refreshes OAuth and sends a frozen RFC 2822 MIME message with inline CID image", async () => {
    const { requests, sender } = await mockGoogle();
    expect(sender.provider).toBe("gmail");
    const message = {
      to: "student@example.edu",
      subject: "Digest",
      text: "Text",
      html: '<img src="cid:plot-1">',
      attachments: [
        {
          filename: "plot.png",
          content: Buffer.from("PNG bytes"),
          contentType: "image/png" as const,
          cid: "plot-1",
          contentDisposition: "inline" as const,
        },
      ],
    };
    const frozen = await sender.prepare!(message);
    await sender.send(frozen);
    await sender.send(frozen);
    expect(requests.map((request) => request.path)).toEqual([
      "/token",
      "/gmail/v1/users/me/messages/send",
      "/gmail/v1/users/me/messages/send",
    ]);
    expect(new URLSearchParams(requests[0]!.body).get("grant_type")).toBe(
      "refresh_token",
    );
    expect(requests[1]!.authorization).toBe("Bearer access-local");
    const first = JSON.parse(requests[1]!.body).raw as string;
    expect(JSON.parse(requests[2]!.body).raw).toBe(first);
    const mime = Buffer.from(first, "base64url").toString();
    expect(mime).toContain("Subject: Digest");
    expect(mime).toContain("Content-ID: <plot-1>");
    expect(mime).toContain(Buffer.from("PNG bytes").toString("base64"));
  });

  it("holds quota failures, retries network/5xx, and treats other 4xx as permanent", async () => {
    const { sender } = await mockGoogle([429, 503, "malformed", 400]);
    await expect(
      sender.send({ to: "student@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toBeInstanceOf(GmailQuotaError);
    await expect(
      sender.send({ to: "student@example.edu", subject: "Hi", text: "body" }),
    ).rejects.not.toBeInstanceOf(PermanentEmailDeliveryError);
    await expect(
      sender.send({ to: "student@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toThrow("invalid send response");
    await expect(
      sender.send({ to: "student@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toBeInstanceOf(PermanentEmailDeliveryError);
  });

  it("holds a revoked OAuth refresh token for operator repair", async () => {
    const { requests, sender } = await mockGoogle([], 400);
    await expect(
      sender.send({ to: "student@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toBeInstanceOf(EmailConfigurationError);
    expect(requests.map((request) => request.path)).toEqual(["/token"]);
  });

  it("refreshes once and retries the identical MIME after a stale access token is rejected", async () => {
    const { requests, sender } = await mockGoogle([401, 200]);
    const frozen = await sender.prepare!({
      to: "student@example.edu",
      subject: "Hi",
      text: "body",
    });
    await sender.send(frozen);
    expect(requests.map((request) => request.path)).toEqual([
      "/token",
      "/gmail/v1/users/me/messages/send",
      "/token",
      "/gmail/v1/users/me/messages/send",
    ]);
    expect(JSON.parse(requests[1]!.body).raw).toBe(
      JSON.parse(requests[3]!.body).raw,
    );
  });

  it("does not send when aborted", async () => {
    const { requests, sender } = await mockGoogle();
    const abort = new AbortController();
    abort.abort();
    await expect(
      sender.send(
        { to: "student@example.edu", subject: "Hi", text: "body" },
        { signal: abort.signal },
      ),
    ).rejects.toThrow();
    expect(requests).toEqual([]);
  });

  it("retries identical MIME after an ambiguous connection drop", async () => {
    const raws: string[] = [];
    const server = createServer(async (request, response) => {
      if (request.url === "/token") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            access_token: "access-local",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        );
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      raws.push(JSON.parse(Buffer.concat(chunks).toString()).raw);
      if (raws.length === 1) request.socket.destroy();
      else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ id: "sent-2" }));
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No mock port");
    const origin = `http://127.0.0.1:${address.port}`;
    const sender = createEmailSender(
      loadEnvironment({
        AUTH_TOKEN_SECRET:
          "a-long-enough-authentication-secret-for-email-tests",
        EMAIL_PROVIDER: "gmail",
        EMAIL_FROM: "sender@gmail.com",
        GMAIL_CLIENT_ID: "local-client",
        GMAIL_CLIENT_SECRET: "local-secret",
        GMAIL_REFRESH_TOKEN: "local-refresh",
        GMAIL_TOKEN_URL: `${origin}/token`,
        GMAIL_API_BASE_URL: origin,
      }),
    );
    const frozen = await sender.prepare!({
      to: "student@example.edu",
      subject: "Hi",
      text: "Body",
    });
    await expect(sender.send(frozen)).rejects.toThrow();
    await sender.send(frozen);
    expect(raws).toHaveLength(2);
    expect(raws[1]).toBe(raws[0]);
  });
});
