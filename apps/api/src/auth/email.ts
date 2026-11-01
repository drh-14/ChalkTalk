import nodemailer from "nodemailer";
import type { Environment } from "../config/environment.js";
import type { EmailSender } from "./service.js";

class GmailUnauthorizedError extends Error {}
export class EmailConfigurationError extends Error {}
export class GmailQuotaError extends Error {}

export function createEmailSender(environment: Environment): EmailSender {
  if (environment.email.provider === "gmail") {
    const config = environment.email;
    const mimeTransport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    let cachedToken: { token: string; expiresAt: number } | undefined;
    const timeoutSignal = (signal?: AbortSignal) =>
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
    const request = async (
      url: string,
      init: RequestInit,
      signal?: AbortSignal,
      kind: "token" | "send" = "send",
    ) => {
      const response = await fetch(url, {
        ...init,
        signal: timeoutSignal(signal),
      });
      if (!response.ok) {
        const status = response.status;
        if (kind === "send" && status === 401)
          throw new GmailUnauthorizedError("Gmail access token was rejected");
        if (status === 429)
          throw new GmailQuotaError(
            "Gmail quota or rate limit reached (HTTP 429)",
          );
        if (
          (kind === "token" &&
            status >= 400 &&
            status < 500 &&
            ![408, 429].includes(status)) ||
          (kind === "send" && status === 403)
        )
          throw new EmailConfigurationError(
            `Gmail authorization needs operator action (HTTP ${status})`,
          );
        if (
          kind === "send" &&
          status >= 400 &&
          status < 500 &&
          ![408, 429].includes(status)
        )
          throw new PermanentEmailDeliveryError(
            `Gmail request rejected (HTTP ${status})`,
          );
        throw new Error(`Gmail request failed (HTTP ${status})`);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("Gmail returned an invalid response");
      }
      return body;
    };
    const accessToken = async (signal?: AbortSignal): Promise<string> => {
      if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000)
        return cachedToken.token;
      const response = (await request(
        config.gmailTokenUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.gmailClientId,
            client_secret: config.gmailClientSecret,
            refresh_token: config.gmailRefreshToken,
            grant_type: "refresh_token",
          }),
        },
        signal,
        "token",
      )) as {
        access_token?: unknown;
        expires_in?: unknown;
        token_type?: unknown;
      };
      if (
        typeof response.access_token !== "string" ||
        !response.access_token ||
        typeof response.expires_in !== "number" ||
        response.expires_in <= 0 ||
        response.token_type !== "Bearer"
      )
        throw new Error("Gmail OAuth returned an invalid token response");
      cachedToken = {
        token: response.access_token,
        expiresAt: Date.now() + response.expires_in * 1000,
      };
      return cachedToken.token;
    };
    const prepare: NonNullable<EmailSender["prepare"]> = async (message) => {
      const from = message.from ?? config.from;
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
        throw new Error("Gmail MIME preparation did not produce a buffer");
      const bytes = compiled.message;
      return {
        ...message,
        from,
        rawMimeBase64Url: bytes.toString("base64url"),
      };
    };
    return {
      provider: "gmail",
      defaultFrom: config.from,
      prepare,
      send: async (message, { signal } = {}) => {
        if (signal?.aborted) throw new Error("Email delivery was aborted");
        const frozen = message.rawMimeBase64Url
          ? message
          : await prepare(message);
        const sendWithToken = async (token: string) =>
          (await request(
            `${config.gmailApiBaseUrl}/gmail/v1/users/me/messages/send`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ raw: frozen.rawMimeBase64Url }),
            },
            signal,
          )) as { id?: unknown };
        let response: { id?: unknown };
        try {
          response = await sendWithToken(await accessToken(signal));
        } catch (error) {
          if (!(error instanceof GmailUnauthorizedError)) throw error;
          cachedToken = undefined;
          try {
            response = await sendWithToken(await accessToken(signal));
          } catch (retryError) {
            if (retryError instanceof GmailUnauthorizedError)
              throw new EmailConfigurationError(
                "Gmail authorization needs operator action (HTTP 401)",
              );
            throw retryError;
          }
        }
        if (typeof response.id !== "string" || !response.id)
          throw new Error("Gmail returned an invalid send response");
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
