export interface Environment {
  databaseUrl: string | undefined;
  port: number;
  frontendOrigins: ReadonlySet<string>;
  frontendBaseUrl: string;
  authTokenSecret: string;
  allowedSchoolDomains: ReadonlySet<string>;
  rateLimits: {
    verificationPerEmail: number;
    verificationPerIp: number;
    loginPerEmail: number;
    loginPerIp: number;
    resetPerEmail: number;
    resetPerIp: number;
    signupPerIp: number;
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
  const port = Number(source.PORT ?? "3000");
  const smtpPort = Number(source.SMTP_PORT ?? "1025");
  const positiveInteger = (name: string, fallback: number): number => {
    const value = Number(source[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer`);
    return value;
  };

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error("SMTP_PORT must be an integer between 1 and 65535");
  }

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
  const allowedSchoolDomains = new Set(
    (source.ALLOWED_SCHOOL_DOMAINS ?? "example.edu")
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    allowedSchoolDomains.size === 0 ||
    [...allowedSchoolDomains].some(
      (domain) =>
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
          domain,
        ),
    )
  ) {
    throw new Error("ALLOWED_SCHOOL_DOMAINS must contain valid domain names");
  }

  return {
    databaseUrl: source.DATABASE_URL,
    port,
    frontendOrigins,
    frontendBaseUrl,
    authTokenSecret,
    allowedSchoolDomains,
    rateLimits: {
      verificationPerEmail: positiveInteger("RATE_LIMIT_VERIFICATION_EMAIL", 5),
      verificationPerIp: positiveInteger("RATE_LIMIT_VERIFICATION_IP", 100),
      loginPerEmail: positiveInteger("RATE_LIMIT_LOGIN_EMAIL", 10),
      loginPerIp: positiveInteger("RATE_LIMIT_LOGIN_IP", 100),
      resetPerEmail: positiveInteger("RATE_LIMIT_RESET_EMAIL", 5),
      resetPerIp: positiveInteger("RATE_LIMIT_RESET_IP", 100),
      signupPerIp: positiveInteger("RATE_LIMIT_SIGNUP_IP", 100),
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
