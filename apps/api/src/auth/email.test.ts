import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import { createEmailSender, PermanentEmailDeliveryError } from "./email.js";

const { send, keys } = vi.hoisted(() => ({
  send: vi.fn(),
  keys: [] as string[],
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    constructor(key: string) {
      keys.push(key);
    }
  },
}));

const environment = loadEnvironment({
  AUTH_TOKEN_SECRET: "a-long-enough-authentication-secret-for-email-tests",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_secret_test",
  EMAIL_FROM: "ChalkTalk <noreply@example.edu>",
});

describe("Resend HTTPS email sender", () => {
  beforeEach(() => {
    send.mockReset();
    keys.length = 0;
    send.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("maps frozen sender, inline CID images, abort signal, and idempotency key", async () => {
    const sender = createEmailSender(environment);
    const controller = new AbortController();
    const image = Buffer.from("PNG bytes");
    await sender.send(
      {
        from: "Original <original@example.edu>",
        to: "recipient@example.edu",
        subject: "Digest",
        text: "Text",
        html: '<img src="cid:plot-1">',
        attachments: [
          {
            filename: "plot.png",
            content: image,
            contentType: "image/png",
            cid: "plot-1",
            contentDisposition: "inline",
          },
        ],
      },
      { signal: controller.signal, idempotencyKey: "digest/delivery-1" },
    );
    expect(keys).toEqual(["re_secret_test"]);
    expect(sender.defaultFrom).toBe("ChalkTalk <noreply@example.edu>");
    expect(send).toHaveBeenCalledWith(
      {
        from: "Original <original@example.edu>",
        to: "recipient@example.edu",
        subject: "Digest",
        text: "Text",
        html: '<img src="cid:plot-1">',
        attachments: [
          {
            filename: "plot.png",
            content: image,
            contentType: "image/png",
            contentId: "plot-1",
          },
        ],
      },
      { signal: controller.signal, idempotencyKey: "digest/delivery-1" },
    );
  });

  it("fails rather than treating an error or malformed success as delivered", async () => {
    const sender = createEmailSender(environment);
    send.mockResolvedValueOnce({
      data: null,
      error: {
        name: "rate_limit_exceeded",
        message: "slow down",
        statusCode: 429,
      },
    });
    await expect(
      sender.send({ to: "r@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toThrow("rate_limit_exceeded");
    send.mockResolvedValueOnce({ data: {}, error: null });
    await expect(
      sender.send({ to: "r@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toThrow("response");
  });

  it("distinguishes permanent Resend rejection from retryable rate limits", async () => {
    const sender = createEmailSender(environment);
    for (const statusCode of [400, 401, 403, 409, 422]) {
      send.mockResolvedValueOnce({
        data: null,
        error: {
          name: "validation_error",
          message: "bad recipient",
          statusCode,
        },
      });
      await expect(
        sender.send({ to: "r@example.edu", subject: "Hi", text: "body" }),
      ).rejects.toBeInstanceOf(PermanentEmailDeliveryError);
    }
    for (const statusCode of [408, 429, 500, 503]) {
      send.mockResolvedValueOnce({
        data: null,
        error: {
          name: "rate_limit_exceeded",
          message: "retry later",
          statusCode,
        },
      });
      await expect(
        sender.send({ to: "r@example.edu", subject: "Hi", text: "body" }),
      ).rejects.not.toBeInstanceOf(PermanentEmailDeliveryError);
    }
  });

  it("preserves a network failure and does not send when already aborted", async () => {
    const sender = createEmailSender(environment);
    const networkError = new Error("network dropped");
    send.mockRejectedValueOnce(networkError);
    await expect(
      sender.send({ to: "r@example.edu", subject: "Hi", text: "body" }),
    ).rejects.toBe(networkError);
    const controller = new AbortController();
    controller.abort();
    await expect(
      sender.send(
        { to: "r@example.edu", subject: "Hi", text: "body" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("aborted");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("propagates a network stall timeout through the HTTPS request signal", async () => {
    const sender = createEmailSender(environment);
    send.mockImplementationOnce(
      (_message: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    await expect(
      sender.send(
        { to: "r@example.edu", subject: "Hi", text: "body" },
        { signal: AbortSignal.timeout(10) },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("bounds an immediate HTTPS send even when its caller gives no signal", async () => {
    const sender = createEmailSender(environment);
    await sender.send({ to: "r@example.edu", subject: "Hi", text: "body" });
    const options = send.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
  });
});
