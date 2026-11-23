import { validateLocalLiteral } from "./local-connections.js";
export type LocalHttpsEmail =
  | {
      provider: "resend";
      from: string;
      resendApiKey: string;
      resendApiBaseUrl: string;
    }
  | { provider: "sendgrid"; from: string; sendgridApiKey: string }
  | {
      provider: "ses";
      from: string;
      region: string;
      credentialsMode: "explicit" | "default-chain";
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      };
    };

export function localEmailConfig(source: NodeJS.ProcessEnv): LocalHttpsEmail {
  for (const [field, value] of Object.entries(source))
    if (
      /^(EMAIL_|RESEND_|SENDGRID_|SES_|SMTP_|AWS_)/.test(field) &&
      value !== undefined
    )
      validateLocalLiteral(field, value);
  const provider = source.EMAIL_PROVIDER;
  if (!["resend", "sendgrid", "ses"].includes(provider ?? ""))
    throw new Error("EMAIL_PROVIDER must be resend, sendgrid, or ses");
  const namespaces = {
    resend: ["RESEND_API_KEY", "RESEND_API_BASE_URL"],
    sendgrid: ["SENDGRID_API_KEY"],
    ses: [
      "SES_REGION",
      "SES_CREDENTIALS_MODE",
      "SES_ACCESS_KEY_ID",
      "SES_SECRET_ACCESS_KEY",
      "SES_SESSION_TOKEN",
    ],
    smtp: [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FROM",
    ],
  };
  for (const [name, fields] of Object.entries(namespaces))
    if (name !== provider)
      for (const field of fields)
        if (source[field]?.trim())
          throw new Error(
            `Remove ${field}; it belongs to an unselected email provider`,
          );
  const required = (field: string): string => {
    if (!source[field]?.trim())
      throw new Error(`${field} is required for the selected email provider`);
    if (/^replace-with|^changeme$|^change-me$/.test(source[field]!))
      throw new Error(`${field} must replace the template placeholder`);
    return source[field]!;
  };
  // A single ASCII mailbox, optionally preceded by an unquoted display name.
  const from = required("EMAIL_FROM");
  if (
    !/^(?:[^<>\r\n,;]+ <)?[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?:>)?$/.test(
      from,
    ) ||
    from.includes("<") !== from.endsWith(">")
  )
    throw new Error(
      "EMAIL_FROM must be one mailbox with an optional display name",
    );
  const mailbox = from.includes("<")
    ? from.slice(from.lastIndexOf("<") + 1, -1)
    : from;
  if (mailbox.length > 254 || mailbox.split("@")[0].length > 64)
    throw new Error("EMAIL_FROM must be one valid mailbox");
  if (provider === "resend")
    return {
      provider,
      from,
      resendApiKey: required("RESEND_API_KEY"),
      resendApiBaseUrl: "https://api.resend.com",
    };
  if (provider === "sendgrid")
    return { provider, from, sendgridApiKey: required("SENDGRID_API_KEY") };
  const region = required("SES_REGION");
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region))
    throw new Error("SES_REGION must be an AWS region");
  const credentialsMode = source.SES_CREDENTIALS_MODE;
  if (credentialsMode !== "explicit" && credentialsMode !== "default-chain")
    throw new Error("SES_CREDENTIALS_MODE must be explicit or default-chain");
  if (credentialsMode === "default-chain") {
    for (const field of [
      "SES_ACCESS_KEY_ID",
      "SES_SECRET_ACCESS_KEY",
      "SES_SESSION_TOKEN",
    ])
      if (source[field]?.trim())
        throw new Error(`Remove ${field} for SES default-chain mode`);
    return { provider: "ses", from, region, credentialsMode };
  }
  return {
    provider: "ses",
    from,
    region,
    credentialsMode,
    credentials: {
      accessKeyId: required("SES_ACCESS_KEY_ID"),
      secretAccessKey: required("SES_SECRET_ACCESS_KEY"),
      ...(source.SES_SESSION_TOKEN
        ? { sessionToken: source.SES_SESSION_TOKEN }
        : {}),
    },
  };
}
