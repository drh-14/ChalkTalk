import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { createEmailSender } from "./email.js";

describe("SMTP sender", () => {
  it("retries a frozen message with identical MIME bytes after rejection", async () => {
    const messages: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost ESMTP\r\n");
      let pending = "";
      let data: string[] | undefined;
      socket.on("data", (chunk: string) => {
        pending += chunk;
        let end: number;
        while ((end = pending.indexOf("\r\n")) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (data) {
            if (line === ".") {
              messages.push(data.join("\r\n") + "\r\n");
              data = undefined;
              socket.write(
                messages.length === 1
                  ? "451 temporary rejection\r\n"
                  : "250 accepted\r\n",
              );
            } else data.push(line);
          } else if (line.startsWith("DATA")) {
            data = [];
            socket.write("354 send data\r\n");
          } else if (line.startsWith("QUIT")) {
            socket.end("221 goodbye\r\n");
          } else {
            socket.write("250 localhost\r\n");
          }
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No port");
      const sender = createEmailSender(
        loadEnvironment({
          AUTH_TOKEN_SECRET:
            "a-long-enough-authentication-secret-for-email-tests",
          SMTP_HOST: "127.0.0.1",
          SMTP_PORT: String(address.port),
          SMTP_FROM: "ChalkTalk <sender@example.edu>",
        }),
      );
      const frozen = await sender.prepare!({
        to: "student@example.edu",
        subject: "Digest",
        text: "Text",
      });
      expect(frozen.rawMimeBase64Url).toBeTruthy();
      await expect(sender.send(frozen)).rejects.toThrow();
      await sender.send(frozen);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toBe(messages[0]);
      expect(messages[0]).toContain("Subject: Digest");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
