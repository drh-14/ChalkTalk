import type { S3ClientConfig } from "@aws-sdk/client-s3";
import {
  FRONTEND_BASE_URL_DEFAULT,
  FRONTEND_ORIGINS_DEFAULT,
  RATE_LIMITS,
  RESEND_EMAIL_FROM,
} from "./constants.js";

function productionMode(source: NodeJS.ProcessEnv): boolean {
  for (const legacy of [
    "PROD",
    "PRODUCTION",
    "LOCAL_DATABASE",
    "LOCAL_FILE_STORE",
  ] as const)
    if (source[legacy] !== undefined)
      throw new Error(`Remove ${legacy}; deployment mode comes from NODE_ENV`);
  if (
    source.NODE_ENV !== undefined &&
    !["development", "test", "production"].includes(source.NODE_ENV)
  )
    throw new Error("NODE_ENV must be development, test, or production");
  return source.NODE_ENV === "production";
}

function supabaseDatabaseProjectRef(value: string | undefined): string {
  if (!value)
    throw new Error("DATABASE_URL is required when NODE_ENV=production");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL when NODE_ENV=production",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    url.pathname === "/" ||
    !url.pathname ||
    url.hash
  )
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL with credentials and database",
    );
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const pooler =
    /^aws-\d+-[a-z]{2}(?:-[a-z]+)+-\d+\.pooler\.supabase\.com$/.test(
      url.hostname,
    );
  const poolerUsername = /^(.+)\.([a-z0-9]{20})$/.exec(url.username);
  if (
    url.port !== "5432" ||
    (!direct && !pooler) ||
    (pooler && !poolerUsername)
  )
    throw new Error(
      "DATABASE_URL must use a Supabase direct or session-pooler endpoint on port 5432",
    );
  const sslModes = url.searchParams.getAll("sslmode");
  if (
    sslModes.length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode") ||
    sslModes[0] !== "verify-full"
  )
    throw new Error(
      "DATABASE_URL must specify sslmode=verify-full when NODE_ENV=production",
    );
  return direct ? direct[1] : poolerUsername![2];
}

function remoteDatabaseUrl(value: string | undefined): string {
  supabaseDatabaseProjectRef(value);
  return value!;
}

export function loadObjectStorageConfig(
  source: NodeJS.ProcessEnv = process.env,
): {
  bucket: string;
  endpoint: string | undefined;
  client: S3ClientConfig;
} {
  const production = productionMode(source);
  const bucket = production
    ? source.SUPABASE_STORAGE_BUCKET
    : (source.S3_BUCKET ?? "chalktalk-resources");
  const region = production
    ? source.SUPABASE_STORAGE_REGION
    : (source.S3_REGION ?? "us-east-1");
  const endpoint = production
    ? source.SUPABASE_STORAGE_ENDPOINT
    : source.S3_ENDPOINT;
  const accessKeyId = production
    ? source.SUPABASE_STORAGE_ACCESS_KEY_ID
    : source.S3_ACCESS_KEY_ID;
  const secretAccessKey = production
    ? source.SUPABASE_STORAGE_SECRET_ACCESS_KEY
    : source.S3_SECRET_ACCESS_KEY;
  if (production) {
    for (const [name, value] of [
      ["SUPABASE_STORAGE_ENDPOINT", endpoint],
      ["SUPABASE_STORAGE_BUCKET", bucket],
      ["SUPABASE_STORAGE_REGION", region],
      ["SUPABASE_STORAGE_ACCESS_KEY_ID", accessKeyId],
      ["SUPABASE_STORAGE_SECRET_ACCESS_KEY", secretAccessKey],
    ])
      if (!value?.trim())
        throw new Error(`${name} is required when NODE_ENV=production`);
    let parsed: URL;
    try {
      parsed = new URL(endpoint!);
    } catch {
      throw new Error(
        "SUPABASE_STORAGE_ENDPOINT must be an HTTPS URL when NODE_ENV=production",
      );
    }
    const storageHost = /^([a-z0-9]{20})(?:\.storage)?\.supabase\.co$/.exec(
      parsed.hostname,
    );
    if (
      parsed.protocol !== "https:" ||
      !storageHost ||
      parsed.port ||
      parsed.pathname !== "/storage/v1/s3" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      storageHost[1] !== supabaseDatabaseProjectRef(source.DATABASE_URL)
    )
      throw new Error(
        "SUPABASE_STORAGE_ENDPOINT must be a same-project Supabase HTTPS S3 URL when NODE_ENV=production",
      );
  }
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
    throw new Error(
      `${production ? "SUPABASE_STORAGE_ACCESS_KEY_ID and SUPABASE_STORAGE_SECRET_ACCESS_KEY" : "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY"} must be set together`,
    );
  if (!production && !endpoint && (!source.S3_BUCKET || !source.S3_REGION))
    throw new Error("S3_BUCKET and S3_REGION are required for managed S3");
  if (!bucket || !region)
    throw new Error(
      production
        ? "SUPABASE_STORAGE_BUCKET and SUPABASE_STORAGE_REGION are required"
        : "S3_BUCKET and S3_REGION are required",
    );
  if (endpoint && !["http:", "https:"].includes(new URL(endpoint).protocol))
    throw new Error(
      `${production ? "SUPABASE_STORAGE_ENDPOINT" : "S3_ENDPOINT"} must use HTTP or HTTPS`,
    );
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
  production: boolean;
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
  const production = productionMode(source);
  const databaseUrl = production
    ? remoteDatabaseUrl(source.DATABASE_URL)
    : source.DATABASE_URL;
  const port = Number(source.PORT ?? "3000");
  const smtpPort = Number(source.SMTP_PORT ?? "1025");
  if (production && source.EMAIL_PROVIDER && source.EMAIL_PROVIDER !== "resend")
    throw new Error("NODE_ENV=production requires Resend");
  const emailProvider = production
    ? "resend"
    : (source.EMAIL_PROVIDER ?? "smtp");
  if (emailProvider !== "smtp" && emailProvider !== "resend")
    throw new Error("EMAIL_PROVIDER must be smtp or resend");
  if (emailProvider === "resend" && !source.RESEND_API_KEY?.trim())
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
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
    if (production && endpoint.origin !== "https://api.resend.com")
      throw new Error(
        "RESEND_API_BASE_URL must be https://api.resend.com when NODE_ENV=production",
      );
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
    (source.FRONTEND_ORIGINS ?? FRONTEND_ORIGINS_DEFAULT)
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
  const frontendBaseUrl = source.FRONTEND_BASE_URL ?? FRONTEND_BASE_URL_DEFAULT;
  if (!frontendOrigins.has(frontendBaseUrl))
    throw new Error("FRONTEND_BASE_URL must be one of FRONTEND_ORIGINS");
  const authTokenSecret = source.AUTH_TOKEN_SECRET;
  if (!authTokenSecret || authTokenSecret.length < 32) {
    throw new Error("AUTH_TOKEN_SECRET must contain at least 32 characters");
  }

  const observabilityEnabled = !production && Boolean(source.METRICS_TOKEN);
  if (observabilityEnabled && source.METRICS_TOKEN!.length < 32)
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
    production,
    port,
    trustProxyHops,
    frontendOrigins,
    frontendBaseUrl,
    authTokenSecret,
    rateLimits: RATE_LIMITS,
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
            from: RESEND_EMAIL_FROM,
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
