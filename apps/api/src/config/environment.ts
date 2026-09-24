export interface Environment {
  databaseUrl: string | undefined;
  port: number;
}

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const port = Number(source.PORT ?? "3000");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    databaseUrl: source.DATABASE_URL,
    port,
  };
}

export function requireDatabaseUrl(environment: Environment): string {
  if (!environment.databaseUrl) {
    throw new Error("DATABASE_URL is required for database operations");
  }

  return environment.databaseUrl;
}
