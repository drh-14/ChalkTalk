import nodemailer from "nodemailer";
import type { Environment } from "../config/environment.js";
import type { EmailSender } from "./service.js";

export function createEmailSender(environment: Environment): EmailSender {
  const transport = nodemailer.createTransport({
    host: environment.smtp.host,
    port: environment.smtp.port,
    secure: environment.smtp.secure,
    auth: environment.smtp.user
      ? { user: environment.smtp.user, pass: environment.smtp.password }
      : undefined,
  });
  return {
    send: async (message, { signal } = {}) => {
      if (signal?.aborted) throw new Error("Email delivery was aborted");
      const abort = () => transport.close();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        await transport.sendMail({ from: environment.smtp.from, ...message });
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
