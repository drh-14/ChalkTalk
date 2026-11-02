import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Environment } from "../config/environment.js";
import type { EmailSender } from "./service.js";

export class EmailConfigurationError extends Error {}
export class EmailQuotaError extends Error {}

export function createEmailSender(environment: Environment): EmailSender {
  const mimeTransport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const prepare: NonNullable<EmailSender["prepare"]> = async (message) => {
    const from = message.from ?? environment.email.from;
    const compiled = await mimeTransport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.attachments
        ? {
            attachments: message.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
              cid: attachment.cid,
              contentDisposition: attachment.contentDisposition,
            })),
          }
        : {}),
    });
    if (!Buffer.isBuffer(compiled.message))
      throw new Error("Email MIME preparation did not produce a buffer");
    return {
      ...message,
      from,
      rawMimeBase64Url: compiled.message.toString("base64url"),
    };
  };
  if (environment.email.provider === "resend") {
    const config = environment.email;
    const client = new Resend(config.resendApiKey, {
      baseUrl: config.resendApiBaseUrl,
    });
    return {
      provider: "resend",
      defaultFrom: config.from,
      prepare: async (message) => ({
        ...message,
        from: message.from ?? config.from,
        attachments: message.attachments?.map((attachment) => ({
          ...attachment,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString("base64")
            : attachment.content,
        })),
      }),
      send: async (message, { signal, idempotencyKey } = {}) => {
        if (signal?.aborted) throw new Error("Email delivery was aborted");
        const frozen = message.from ? message : await createPrepared(message);
        const response = await client.emails.send(
          {
            from: frozen.from!,
            to: frozen.to,
            subject: frozen.subject,
            text: frozen.text,
            ...(frozen.html ? { html: frozen.html } : {}),
            ...(frozen.attachments
              ? {
                  attachments: frozen.attachments.map((attachment) => ({
                    filename: attachment.filename,
                    content: attachment.content,
                    contentType: attachment.contentType,
                    contentId: attachment.cid,
                  })),
                }
              : {}),
          },
          {
            signal: signal ?? AbortSignal.timeout(30_000),
            idempotencyKey,
          },
        );
        if (response.error) {
          const status = response.error.statusCode;
          const description = `Resend rejected email: ${response.error.name}`;
          if (status === 429) throw new EmailQuotaError(description);
          if (status === 401 || status === 403)
            throw new EmailConfigurationError(description);
          if (
            status !== null &&
            status >= 400 &&
            status < 500 &&
            status !== 408 &&
            status !== 429
          )
            throw new PermanentEmailDeliveryError(description);
          throw new Error(description);
        }
        if (!response.data?.id)
          throw new Error("Resend returned an invalid response");
      },
    };
    async function createPrepared(message: Parameters<EmailSender["send"]>[0]) {
      return {
        ...message,
        from: message.from ?? config.from,
        attachments: message.attachments?.map((attachment) => ({
          ...attachment,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString("base64")
            : attachment.content,
        })),
      };
    }
  }
  const transport = nodemailer.createTransport({
    host: environment.smtp.host,
    port: environment.smtp.port,
    secure: environment.smtp.secure,
    auth: environment.smtp.user
      ? { user: environment.smtp.user, pass: environment.smtp.password }
      : undefined,
  });
  return {
    provider: "smtp",
    defaultFrom: environment.email.from,
    prepare,
    send: async (message, { signal } = {}) => {
      if (signal?.aborted) throw new Error("Email delivery was aborted");
      const frozen = message.rawMimeBase64Url
        ? message
        : await prepare(message);
      const abort = () => transport.close();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await transport.sendMail({
          from: frozen.from,
          to: frozen.to,
          raw: Buffer.from(frozen.rawMimeBase64Url!, "base64url"),
        });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

export class PermanentEmailDeliveryError extends Error {}
