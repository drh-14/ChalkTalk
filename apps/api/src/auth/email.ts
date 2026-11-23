import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
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
        let response: Awaited<ReturnType<typeof client.emails.send>>;
        try {
          response = await client.emails.send(
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
        } catch (error) {
          if (
            error instanceof DOMException &&
            ["AbortError", "TimeoutError"].includes(error.name)
          )
            throw new DOMException("Email delivery aborted", error.name);
          throw new Error("Resend delivery unavailable");
        }
        if (response.error) {
          const status = response.error.statusCode;
          const allowedNames = [
            "rate_limit_exceeded",
            "validation_error",
            "restricted_api_key",
            "invalid_api_key",
            "missing_api_key",
            "invalid_from_address",
            "internal_server_error",
            "application_error",
            "not_found",
            "invalid_attachment",
            "daily_quota_exceeded",
            "monthly_quota_exceeded",
          ];
          const name = allowedNames.includes(response.error.name)
            ? response.error.name
            : "provider_error";
          const description = `Resend rejected email: ${name}`;
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
  if (environment.email.provider === "sendgrid") {
    const config = environment.email;
    const prepareSendGrid: NonNullable<EmailSender["prepare"]> = async (
      message,
    ) => {
      const from = message.from ?? config.from;
      const named = /^(.*) <([^<>]+)>$/.exec(from);
      const body = {
        personalizations: [{ to: [{ email: message.to }] }],
        from: named ? { email: named[2], name: named[1] } : { email: from },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          ...(message.html ? [{ type: "text/html", value: message.html }] : []),
        ],
        ...(message.attachments
          ? {
              attachments: message.attachments.map((attachment) => ({
                content: Buffer.isBuffer(attachment.content)
                  ? attachment.content.toString("base64")
                  : attachment.content,
                filename: attachment.filename,
                type: attachment.contentType,
                disposition: attachment.contentDisposition,
                content_id: attachment.cid,
              })),
            }
          : {}),
      };
      return {
        ...message,
        from,
        providerPayload: JSON.stringify(body),
        attachments: message.attachments?.map((attachment) => ({
          ...attachment,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content.toString("base64")
            : attachment.content,
        })),
      };
    };
    return {
      provider: "sendgrid",
      defaultFrom: config.from,
      prepare: prepareSendGrid,
      send: async (message, { signal } = {}) => {
        const bounded = boundedSignal(signal);
        if (bounded.aborted) throw new Error("Email delivery was aborted");
        const frozen = message.providerPayload
          ? message
          : await prepareSendGrid(message);
        let response: Response;
        try {
          response = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.sendgridApiKey}`,
              "Content-Type": "application/json",
            },
            body: frozen.providerPayload,
            signal: bounded,
          });
        } catch {
          throw new Error("SendGrid delivery unavailable");
        }
        // Do not read or persist the provider response body (it may contain private data).
        try {
          void response.body?.cancel().catch(() => {});
        } catch {
          // Best-effort cleanup must not override confirmed provider acceptance.
        }
        if (response.status !== 202)
          throwDeliveryStatus("SendGrid", response.status);
      },
    };
  }
  if (environment.email.provider === "ses") {
    const config = environment.email;
    // Omitting credentials retains the SDK's refreshable provider chain; never resolve
    // and replace it with a credential snapshot. Each process owns its own client.
    const client = new SESv2Client({
      region: config.region,
      maxAttempts: 1,
      ignoreConfiguredEndpointUrls: true,
      ...(config.credentialsMode === "explicit"
        ? { credentials: config.credentials }
        : {}),
    });
    return {
      provider: "ses",
      defaultFrom: config.from,
      prepare,
      send: async (message, { signal } = {}) => {
        const bounded = boundedSignal(signal);
        if (bounded.aborted) throw new Error("Email delivery was aborted");
        const frozen = message.rawMimeBase64Url
          ? message
          : await prepare(message);
        let response;
        try {
          response = await abortable(
            client.send(
              new SendEmailCommand({
                FromEmailAddress: frozen.from,
                Destination: { ToAddresses: [frozen.to] },
                Content: {
                  Raw: {
                    Data: Buffer.from(frozen.rawMimeBase64Url!, "base64url"),
                  },
                },
              }),
              { abortSignal: bounded },
            ),
            bounded,
          );
        } catch (error) {
          const status =
            typeof error === "object" && error !== null && "$metadata" in error
              ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
              : undefined;
          const name =
            typeof error === "object" && error !== null && "name" in error
              ? error.name
              : undefined;
          if (
            name === "ThrottlingException" ||
            name === "TooManyRequestsException"
          )
            throw new EmailQuotaError("SES delivery throttled");
          if (
            [
              "CredentialsProviderError",
              "TokenProviderError",
              "ExpiredTokenException",
              "ExpiredToken",
              "AccountSuspendedException",
              "MailFromDomainNotVerifiedException",
              "SendingPausedException",
              "InvalidClientTokenId",
              "UnrecognizedClientException",
              "SignatureDoesNotMatch",
            ].includes(String(name))
          )
            throw new EmailConfigurationError(
              "SES credentials require operator repair",
            );
          throwDeliveryStatus("SES", status);
        }
        if (!response?.MessageId?.trim())
          throw new Error("SES returned invalid acceptance");
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

function boundedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function throwDeliveryStatus(provider: string, status?: number): never {
  const description = `${provider} delivery failed (${status ?? "unavailable"})`;
  if (status === 429) throw new EmailQuotaError(description);
  if (status === 401 || status === 403)
    throw new EmailConfigurationError(description);
  if (status && status >= 400 && status < 500 && status !== 408)
    throw new PermanentEmailDeliveryError(description);
  throw new Error(description);
}

async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    throw new Error("SES delivery unavailable");
  }
  let abort: () => void = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("SES delivery unavailable"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
