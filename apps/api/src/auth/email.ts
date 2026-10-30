import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { Environment } from "../config/environment.js";
import type { EmailSender } from "./service.js";

export function createEmailSender(environment: Environment): EmailSender {
  if (environment.email.provider === "resend") {
    const client = new Resend(environment.email.resendApiKey);
    return {
      defaultFrom: environment.email.from,
      send: async (message, { signal, idempotencyKey } = {}) => {
        if (signal?.aborted) throw new Error("Email delivery was aborted");
        const response = await client.emails.send(
          {
            from: message.from ?? environment.email.from,
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
                    contentId: attachment.cid,
                  })),
                }
              : {}),
          },
          { signal: signal ?? AbortSignal.timeout(30_000), idempotencyKey },
        );
        if (response.error) {
          const status = response.error.statusCode;
          const description = `Resend rejected email: ${response.error.name}`;
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
    defaultFrom: environment.email.from,
    send: async (message, { signal } = {}) => {
      if (signal?.aborted) throw new Error("Email delivery was aborted");
      const abort = () => transport.close();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await transport.sendMail({ from: environment.email.from, ...message });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}

export class PermanentEmailDeliveryError extends Error {}
