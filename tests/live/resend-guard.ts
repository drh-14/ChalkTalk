import { createHash } from "node:crypto";
import type { EmailSender } from "../../apps/api/src/auth/service.js";
import { RESEND_EMAIL_FROM } from "../../apps/api/src/config/constants.js";

const APPROVED_RECIPIENT_SHA256 =
  "1df1c8c207742ce445de1177ef78dca9d1e8e9da202abeb409d6f7a1ff01afc9";

export type LiveConfig = {
  recipient: string;
  sender: string;
  apiKey: string;
  adminDatabaseUrl: string;
};

/** Fail closed before opening PostgreSQL or making any network request. */
export function checkedLiveConfig(
  source: NodeJS.ProcessEnv,
  approvedRecipientSha256 = APPROVED_RECIPIENT_SHA256,
): LiveConfig {
  if (source.RESEND_LIVE_CONFIRM !== "send-synthetic-mail")
    throw new Error("Explicit live-send confirmation is required");
  const recipient = source.RESEND_LIVE_RECIPIENT?.trim().toLowerCase() ?? "";
  const digest = createHash("sha256").update(recipient).digest("hex");
  if (digest !== approvedRecipientSha256)
    throw new Error("Recipient is not the approved live-test inbox");
  if (
    source.EMAIL_PROVIDER !== "resend" ||
    !source.RESEND_API_KEY?.startsWith("re_")
  )
    throw new Error("A configured Resend API key is required");
  const sender = RESEND_EMAIL_FROM;
  if (
    source.RESEND_API_BASE_URL &&
    source.RESEND_API_BASE_URL !== "https://api.resend.com"
  )
    throw new Error("Live validation must use the real Resend HTTPS endpoint");
  const adminDatabaseUrl = source.TEST_DATABASE_URL ?? "";
  let database: URL;
  try {
    database = new URL(adminDatabaseUrl);
  } catch {
    throw new Error("A loopback disposable PostgreSQL server is required");
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
    !database.pathname.slice(1)
  )
    throw new Error("A loopback disposable PostgreSQL server is required");
  return { recipient, sender, apiKey: source.RESEND_API_KEY, adminDatabaseUrl };
}

/** Only this test adapter can redirect mail. Production senders remain unchanged. */
export function redirectTestMail(
  sender: EmailSender,
  approvedRecipient: string,
  syntheticDomain: string,
  maxSends: number,
): EmailSender & {
  sentCount: () => number;
  lastMessage: () => Parameters<EmailSender["send"]>[0] | undefined;
  waitForLastSend: (timeoutMs: number) => Promise<boolean>;
} {
  let sent = 0;
  let attempted = 0;
  let lastMessage: Parameters<EmailSender["send"]>[0] | undefined;
  let lastOutcome: Promise<boolean> | undefined;
  return {
    provider: sender.provider,
    defaultFrom: sender.defaultFrom,
    ...(sender.prepare
      ? { prepare: (message) => sender.prepare!(message) }
      : {}),
    sentCount: () => sent,
    lastMessage: () => lastMessage,
    async waitForLastSend(timeoutMs) {
      if (!lastOutcome) return false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          lastOutcome,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async send(message, options) {
      if (!message.to.toLowerCase().endsWith(`@${syntheticDomain}`))
        throw new Error("Live test refused a non-synthetic original recipient");
      if (attempted >= maxSends)
        throw new Error("Live test send budget exceeded");
      attempted += 1;
      const delivery = Promise.resolve()
        .then(() => sender.send({ ...message, to: approvedRecipient }, options))
        .then(() => {
          sent += 1;
          lastMessage = message;
        });
      lastOutcome = delivery.then(
        () => true,
        () => false,
      );
      await delivery;
    },
  };
}
