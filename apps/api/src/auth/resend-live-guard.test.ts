import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { EmailSender } from "./service.js";
import {
  checkedLiveConfig,
  redirectTestMail,
} from "../../../../tests/live/resend-guard.js";

const valid = {
  RESEND_LIVE_CONFIRM: "send-synthetic-mail",
  RESEND_LIVE_RECIPIENT: "approved@example.test",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "notifications@joinchalktalk.com",
  RESEND_API_KEY: "re_test_key",
  TEST_DATABASE_URL: "postgres://test:secret@127.0.0.1:5432/postgres",
};
const approvedHash = createHash("sha256")
  .update(valid.RESEND_LIVE_RECIPIENT)
  .digest("hex");

describe("manual live Resend safety boundary", () => {
  it("requires explicit opt-in, approved recipient, real endpoint, and loopback database", () => {
    expect(checkedLiveConfig(valid, approvedHash).recipient).toBe(
      valid.RESEND_LIVE_RECIPIENT,
    );
    for (const [key, value] of [
      ["RESEND_LIVE_CONFIRM", ""],
      ["RESEND_LIVE_RECIPIENT", "someone-else@gmail.com"],
      ["EMAIL_PROVIDER", "smtp"],
      ["RESEND_API_KEY", ""],
      ["EMAIL_FROM", "sender@gmail.com"],
      ["RESEND_API_BASE_URL", "http://127.0.0.1:3000"],
      [
        "TEST_DATABASE_URL",
        "postgres://test:secret@db.example.com:5432/chalktalk",
      ],
    ] as const) {
      expect(() =>
        checkedLiveConfig({ ...valid, [key]: value }, approvedHash),
      ).toThrow();
    }
  });

  it("redirects only synthetic recipients at final send and preserves prepare and options", async () => {
    const prepare = vi.fn(
      async (message: Parameters<EmailSender["send"]>[0]) => message,
    );
    const send = vi.fn(async () => undefined);
    const wrapped = redirectTestMail(
      { provider: "resend", defaultFrom: valid.EMAIL_FROM, prepare, send },
      valid.RESEND_LIVE_RECIPIENT,
      "synthetic.example.edu",
      2,
    );
    const message = {
      to: "alice@synthetic.example.edu",
      subject: "Test",
      text: "Body",
    };
    expect(await wrapped.prepare!(message)).toEqual(message);
    expect(prepare).toHaveBeenCalledWith(message);
    await wrapped.send(message, { idempotencyKey: "job-test" });
    expect(send).toHaveBeenCalledWith(
      { ...message, to: valid.RESEND_LIVE_RECIPIENT },
      { idempotencyKey: "job-test" },
    );
    await expect(
      wrapped.send({ ...message, to: "real@school.edu" }),
    ).rejects.toThrow();
    await wrapped.send(message);
    await expect(wrapped.send(message)).rejects.toThrow();
  });
});
