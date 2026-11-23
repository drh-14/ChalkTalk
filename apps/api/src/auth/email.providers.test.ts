import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEnvironment } from "../config/environment.js";
import {
  createEmailSender,
  EmailConfigurationError,
  EmailQuotaError,
  PermanentEmailDeliveryError,
} from "./email.js";
const sdk = vi.hoisted(() => ({
  send: vi.fn(),
  configurations: [] as Record<string, unknown>[],
}));
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    config;
    constructor(config: Record<string, unknown>) {
      sdk.configurations.push(config);
      this.config = config;
    }
    send = sdk.send;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));
const message = {
  to: "recipient@example.test",
  subject: "Verification",
  text: "Verify https://localhost:5173/verify?token=synthetic",
  html: '<img src="cid:plot">',
  attachments: [
    {
      filename: "plot.png",
      content: Buffer.from("synthetic-image"),
      contentType: "image/png" as const,
      cid: "plot",
      contentDisposition: "inline" as const,
    },
  ],
};
const base = {
  AUTH_TOKEN_SECRET: "synthetic-authentication-secret-with-32-characters",
  EMAIL_FROM: "ChalkTalk <mail@example.test>",
};
const sources = {
  sendgrid: {
    ...base,
    EMAIL_PROVIDER: "sendgrid",
    SENDGRID_API_KEY: "sensitive-sentinel",
  },
  ses: {
    ...base,
    EMAIL_PROVIDER: "ses",
    SES_REGION: "us-east-1",
    SES_CREDENTIALS_MODE: "explicit",
    SES_ACCESS_KEY_ID: "sensitive-sentinel",
    SES_SECRET_ACCESS_KEY: "sensitive-sentinel",
  },
};
describe("local HTTPS email adapters", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    sdk.send.mockReset();
    sdk.configurations.length = 0;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    sdk.send.mockResolvedValue({ MessageId: "accepted" });
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
  });
  for (const provider of ["sendgrid", "ses"] as const) {
    it(`${provider} prepares once, retains inline images, and reuses identical content on retry`, async () => {
      const sender = createEmailSender(loadEnvironment(sources[provider]));
      expect(sender.provider).toBe(provider);
      const frozen = await sender.prepare!(message);
      expect(frozen.from).toBe(base.EMAIL_FROM);
      await sender.send(frozen);
      await sender.send(frozen);
      if (provider === "sendgrid") {
        const [url, request] = fetchMock.mock.calls[0];
        expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
        expect(request.body).toBe(fetchMock.mock.calls[1][1].body);
        const body = JSON.parse(request.body);
        expect(body.attachments[0]).toMatchObject({
          content: message.attachments[0].content.toString("base64"),
          content_id: "plot",
          disposition: "inline",
        });
        expect(body.from).toEqual({
          email: "mail@example.test",
          name: "ChalkTalk",
        });
      } else {
        expect(sdk.configurations[0]).toMatchObject({
          region: "us-east-1",
          maxAttempts: 1,
        });
        const first = sdk.send.mock.calls[0][0].input;
        expect(first.Content.Raw.Data).toEqual(
          sdk.send.mock.calls[1][0].input.Content.Raw.Data,
        );
        expect(Buffer.from(first.Content.Raw.Data).toString()).toContain(
          "Content-ID: <plot>",
        );
      }
    });
    it(`${provider} never hands off an already aborted attempt`, async () => {
      const sender = createEmailSender(loadEnvironment(sources[provider]));
      await expect(
        sender.send(message, { signal: AbortSignal.abort() }),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sdk.send).not.toHaveBeenCalled();
    });
    for (const [status, ErrorType] of [
      [429, EmailQuotaError],
      [403, EmailConfigurationError],
      [400, PermanentEmailDeliveryError],
      [503, Error],
    ] as const)
      it(`${provider} classifies ${status} and redacts provider details`, async () => {
        fetchMock.mockResolvedValue(
          new Response("sensitive-sentinel", { status }),
        );
        sdk.send.mockRejectedValue({
          message: "sensitive-sentinel",
          $metadata: { httpStatusCode: status },
        });
        const sender = createEmailSender(loadEnvironment(sources[provider]));
        await expect(sender.send(message)).rejects.toBeInstanceOf(ErrorType);
        await expect(sender.send(message)).rejects.not.toThrow(
          "sensitive-sentinel",
        );
      });
    it(`${provider} rejects malformed acceptance`, async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      sdk.send.mockResolvedValue({});
      await expect(
        createEmailSender(loadEnvironment(sources[provider])).send(message),
      ).rejects.toThrow();
    });
  }
  it("treats SendGrid acceptance as delivered even when response cleanup fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("sensitive-sentinel"));
    fetchMock.mockResolvedValue({ status: 202, body: { cancel } });
    const sender = createEmailSender(loadEnvironment(sources.sendgrid));
    await expect(sender.send(message)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("classifies SendGrid rejection despite response cleanup failure", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("sensitive-sentinel"));
    fetchMock.mockResolvedValue({ status: 429, body: { cancel } });
    const sender = createEmailSender(loadEnvironment(sources.sendgrid));
    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailQuotaError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("does not snapshot a default-chain credential result into the client", () => {
    createEmailSender(
      loadEnvironment({
        ...base,
        EMAIL_PROVIDER: "ses",
        SES_REGION: "us-east-1",
        SES_CREDENTIALS_MODE: "default-chain",
      }),
    );
    expect(sdk.configurations[0].credentials).toBeUndefined();
  });
});

it("bounds an SES attempt even while credential/SDK work stalls", async () => {
  vi.useFakeTimers();
  try {
    sdk.send.mockImplementation(() => new Promise(() => {}));
    const sender = createEmailSender(loadEnvironment(sources.ses));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30_000);
    const sending = sender.send(
      { ...message, rawMimeBase64Url: "c3ludGhldGlj" },
      { signal: controller.signal },
    );
    const rejected = expect(sending).rejects.toThrow(
      "SES delivery failed (unavailable)",
    );
    await vi.advanceTimersByTimeAsync(30_001);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  "ExpiredToken",
  "ExpiredTokenException",
  "AccountSuspendedException",
  "MailFromDomainNotVerifiedException",
  "SendingPausedException",
])(
  "keeps SES configuration error %s repairable without exposing provider details",
  async (name) => {
    sdk.send.mockRejectedValue({
      name,
      message: "sensitive-sentinel",
      $metadata: { httpStatusCode: 400 },
    });
    const sender = createEmailSender(loadEnvironment(sources.ses));
    await expect(
      sender.send({ ...message, rawMimeBase64Url: "c3ludGhldGlj" }),
    ).rejects.toBeInstanceOf(EmailConfigurationError);
  },
);
