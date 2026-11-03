import type { S3ClientConfig } from "@aws-sdk/client-s3";

function localMode(
  source: NodeJS.ProcessEnv,
  name: "LOCAL_DATABASE" | "LOCAL_FILE_STORE",
): boolean {
  const value = source[name];
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function remoteDatabaseUrl(value: string | undefined): string {
  if (!value)
    throw new Error("DATABASE_URL is required when LOCAL_DATABASE=false");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL when LOCAL_DATABASE=false",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.username ||
    !url.password ||
    url.pathname === "/" ||
    !url.pathname
  )
    throw new Error(
      "DATABASE_URL must be a remote PostgreSQL URL with credentials and database",
    );
  const sslModes = url.searchParams.getAll("sslmode");
  if (
    sslModes.length !== 1 ||
    !["require", "verify-ca", "verify-full"].includes(sslModes[0])
  )
    throw new Error(
      "DATABASE_URL must specify sslmode=require, verify-ca, or verify-full when LOCAL_DATABASE=false",
    );
  return value;
}

export function loadObjectStorageConfig(
  source: NodeJS.ProcessEnv = process.env,
): {
  bucket: string;
  endpoint: string | undefined;
  client: S3ClientConfig;
} {
  const bucket = source.S3_BUCKET ?? "chalktalk-resources";
  const region = source.S3_REGION ?? "us-east-1";
  const endpoint = source.S3_ENDPOINT;
  const accessKeyId = source.S3_ACCESS_KEY_ID;
  const secretAccessKey = source.S3_SECRET_ACCESS_KEY;
  const localFileStore = localMode(source, "LOCAL_FILE_STORE");
  if (!localFileStore) {
    for (const [name, value] of [
      ["S3_ENDPOINT", endpoint],
      ["S3_BUCKET", source.S3_BUCKET],
      ["S3_REGION", source.S3_REGION],
      ["S3_ACCESS_KEY_ID", accessKeyId],
      ["S3_SECRET_ACCESS_KEY", secretAccessKey],
    ])
      if (!value?.trim())
        throw new Error(`${name} is required when LOCAL_FILE_STORE=false`);
    let parsed: URL;
    try {
      parsed = new URL(endpoint!);
    } catch {
      throw new Error(
        "S3_ENDPOINT must be an HTTPS URL when LOCAL_FILE_STORE=false",
      );
    }
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        "S3_ENDPOINT must be a remote HTTPS URL when LOCAL_FILE_STORE=false",
      );
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together",
    );
  if (!endpoint && (!source.S3_BUCKET || !source.S3_REGION))
    throw new Error("S3_BUCKET and S3_REGION are required for managed S3");
  if (!bucket || !region)
    throw new Error("S3_BUCKET and S3_REGION are required");
  if (endpoint && !["http:", "https:"].includes(new URL(endpoint).protocol))
    throw new Error("S3_ENDPOINT must use HTTP or HTTPS");
  return {
    bucket,
    endpoint,
    client: {
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    },
  };
}

export interface Environment {
  databaseUrl: string | undefined;
  localDatabase: boolean;
  localFileStore: boolean;
  port: number;
  trustProxyHops: 0 | 1;
  frontendOrigins: ReadonlySet<string>;
  frontendBaseUrl: string;
  authTokenSecret: string;
  rateLimits: {
    verificationPerEmail: number;
    verificationPerIp: number;
    loginPerEmail: number;
    loginPerIp: number;
    resetPerEmail: number;
    resetPerIp: number;
    signupPerIp: number;
    collaborationCreatePerUser: number;
    collaborationTicketPerUser: number;
  };
  observability: {
    enabled: boolean;
    metricsToken: string | undefined;
    spoolDirectory: string | undefined;
  };
  collaboration: {
    port: number;
    publicUrl: string;
    idleEndMinutes: number;
  };
  email:
    | { provider: "smtp"; from: string }
    | {
        provider: "resend";
        from: string;
        resendApiKey: string;
        resendApiBaseUrl: string;
      };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    password: string | undefined;
    from: string;
  };
}

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const localDatabase = localMode(source, "LOCAL_DATABASE");
  const localFileStore = localMode(source, "LOCAL_FILE_STORE");
  const databaseUrl = localDatabase
    ? source.DATABASE_URL
    : remoteDatabaseUrl(source.DATABASE_URL);
  const port = Number(source.PORT ?? "3000");
  const smtpPort = Number(source.SMTP_PORT ?? "1025");
  const emailProvider = source.EMAIL_PROVIDER ?? "smtp";
  if (emailProvider !== "smtp" && emailProvider !== "resend")
    throw new Error("EMAIL_PROVIDER must be smtp or resend");
  if (emailProvider === "resend" && !source.RESEND_API_KEY?.trim())
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
  if (emailProvider === "resend" && !source.EMAIL_FROM?.trim())
    throw new Error("EMAIL_FROM is required when EMAIL_PROVIDER=resend");
  let resendApiBaseUrl = "https://api.resend.com";
  if (emailProvider === "resend" && source.RESEND_API_BASE_URL !== undefined) {
    let endpoint: URL;
    try {
      endpoint = new URL(source.RESEND_API_BASE_URL);
    } catch {
      throw new Error("RESEND_API_BASE_URL must be an HTTP or HTTPS origin");
    }
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("RESEND_API_BASE_URL must be an HTTP or HTTPS origin");
    resendApiBaseUrl = endpoint.origin;
  }
  const positiveInteger = (name: string, fallback: number): number => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
    return value;
  };

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  if (
    emailProvider === "smtp" &&
    (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
  ) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }
  if (
    source.TRUST_PROXY_HOPS !== undefined &&
    !["0", "1"].includes(source.TRUST_PROXY_HOPS)
  )
    throw new Error("TRUST_PROXY_HOPS must be 0 or 1");
  const trustProxyHops = source.TRUST_PROXY_HOPS === "1" ? 1 : 0;

  const frontendOrigins = new Set(
    (source.FRONTEND_ORIGINS ?? "https://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  for (const origin of frontendOrigins) {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" || parsed.origin !== origin) {
      throw new Error("FRONTEND_ORIGINS must contain HTTPS origins only");
    }
  }
  const frontendBaseUrl = source.FRONTEND_BASE_URL ?? "https://localhost:5173";
  if (!frontendOrigins.has(frontendBaseUrl))
    throw new Error("FRONTEND_BASE_URL must be one of FRONTEND_ORIGINS");
  const authTokenSecret = source.AUTH_TOKEN_SECRET;
  if (!authTokenSecret || authTokenSecret.length < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters");
  }

  const observabilityEnabled = source.OBSERVABILITY_ENABLED === "true";
  if (
    source.OBSERVABILITY_ENABLED !== undefined &&
    !["true", "false"].includes(source.OBSERVABILITY_ENABLED)
  )
    throw new Error("OBSERVABILITY_ENABLED must be true or false");
  if (
    observabilityEnabled &&
    (!source.METRICS_TOKEN || source.METRICS_TOKEN.length < 32)
  )
    throw new Error(
      "METRICS_TOKEN must contain at least 32 characters when observability is enabled",
    );
  if (observabilityEnabled && !source.LOG_SPOOL_DIRECTORY)
    throw new Error(
      "LOG_SPOOL_DIRECTORY is required when observability is enabled",
    );

  const collaborationPort = Number(source.COLLABORATION_PORT ?? "3100");
  if (
    !Number.isInteger(collaborationPort) ||
    collaborationPort < 1 ||
    collaborationPort > 65535
  )
    throw new Error(
      "COLLABORATION_PORT must be an integer between 1 and 65535",
    );
  const collaborationPublicUrl =
    source.COLLABORATION_PUBLIC_URL ??
    `${frontendBaseUrl.replace(/^https:/, "wss:")}/collaboration`;
  if (!/^wss?:\/\//.test(collaborationPublicUrl))
    throw new Error("COLLABORATION_PUBLIC_URL must be a ws or wss URL");
  const idleEndMinutes = positiveInteger("COLLABORATION_IDLE_END_MINUTES", 120);
  if (idleEndMinutes > 10_080)
    throw new Error(
      "COLLABORATION_IDLE_END_MINUTES must be at most 10080 (one week)",
    );

  return {
    databaseUrl,
    localDatabase,
    localFileStore,
    port,
    trustProxyHops,
    frontendOrigins,
    frontendBaseUrl,
    authTokenSecret,
    rateLimits: {
      verificationPerEmail: positiveInteger("RATE_LIMIT_VERIFICATION_EMAIL", 5),
      verificationPerIp: positiveInteger("RATE_LIMIT_VERIFICATION_IP", 100),
      loginPerEmail: positiveInteger("RATE_LIMIT_LOGIN_EMAIL", 10),
      loginPerIp: positiveInteger("RATE_LIMIT_LOGIN_IP", 100),
      resetPerEmail: positiveInteger("RATE_LIMIT_RESET_EMAIL", 5),
      resetPerIp: positiveInteger("RATE_LIMIT_RESET_IP", 100),
      signupPerIp: positiveInteger("RATE_LIMIT_SIGNUP_IP", 100),
      collaborationCreatePerUser: positiveInteger(
        "RATE_LIMIT_COLLABORATION_CREATE_USER",
        30,
      ),
      collaborationTicketPerUser: positiveInteger(
        "RATE_LIMIT_COLLABORATION_TICKET_USER",
        300,
      ),
    },
    observability: {
      enabled: observabilityEnabled,
      metricsToken: observabilityEnabled ? source.METRICS_TOKEN : undefined,
      spoolDirectory: observabilityEnabled
        ? source.LOG_SPOOL_DIRECTORY
        : undefined,
    },
    collaboration: {
      port: collaborationPort,
      publicUrl: collaborationPublicUrl,
      idleEndMinutes,
    },
    email:
      emailProvider === "resend"
        ? {
            provider: "resend",
            from: source.EMAIL_FROM!.trim(),
            resendApiKey: source.RESEND_API_KEY!.trim(),
            resendApiBaseUrl,
          }
        : {
            provider: "smtp",
            from: source.SMTP_FROM ?? "ChalkTalk <noreply@chalktalk.local>",
          },
    smtp: {
      host: source.SMTP_HOST ?? "localhost",
      port: smtpPort,
      secure: source.SMTP_SECURE === "true",
      user: source.SMTP_USER,
      password: source.SMTP_PASSWORD,
      from: source.SMTP_FROM ?? "ChalkTalk <noreply@chalktalk.local>",
    },
  };
}

export function requireDatabaseUrl(environment: Environment): string {
  if (!environment.databaseUrl) {
    throw new Error("DATABASE_URL is required for database operations");
  }

  return environment.databaseUrl;
}
