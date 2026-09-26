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
    send: async (message) =>
      transport
        .sendMail({ from: environment.smtp.from, ...message })
        .then(() => undefined),
  };
}
