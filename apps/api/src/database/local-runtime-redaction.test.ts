import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";

it("does not trust a remote database error that impersonates a safe migration diagnostic", async () => {
  let requests = 0;
  const server = createServer((socket) =>
    socket.once("data", () => {
      requests++;
      const fields = Buffer.from(
        "SFATAL\0C28000\0MExternal ordinary migrations pending: sensitive-sentinel\0\0",
      );
      const packet = Buffer.alloc(fields.length + 5);
      packet[0] = 69;
      packet.writeInt32BE(fields.length + 4, 1);
      fields.copy(packet, 5);
      socket.end(packet);
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fake database port");
  try {
    const result = await new Promise<{ status: number | null; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "deployment/local/runtime.ts",
            "check",
            "false",
            "false",
            "false",
          ],
          {
            env: {
              PATH: process.env.PATH,
              NODE_ENV: "development",
              AUTH_TOKEN_SECRET: "synthetic-secret-with-at-least-32-characters",
              EMAIL_PROVIDER: "resend",
              EMAIL_FROM: "mail@example.test",
              RESEND_API_KEY: "synthetic",
              DATABASE_URL: `postgresql://fixture:synthetic@127.0.0.1:${address.port}/fixture`,
              S3_ENDPOINT: "http://127.0.0.1:1",
              S3_BUCKET: "fixture",
              S3_REGION: "us-east-1",
              S3_ACCESS_KEY_ID: "synthetic",
              S3_SECRET_ACCESS_KEY: "synthetic",
            },
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.once("error", reject);
        child.once("close", (status) => resolve({ status, stderr }));
      },
    );
    expect(requests).toBeGreaterThan(0);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("sensitive-sentinel");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10_000);
