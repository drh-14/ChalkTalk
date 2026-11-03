import { describe, expect, it } from "vitest";
import { loadEnvironment, loadObjectStorageConfig } from "./environment.js";

const base = {
  AUTH_TOKEN_SECRET: "this-is-a-development-secret-that-is-long-enough",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
};

describe("authentication environment", () => {
  it("selects local database and file storage unless strict flags choose managed services", () => {
    expect(loadEnvironment(base).localDatabase).toBe(true);
    expect(loadEnvironment(base).localFileStore).toBe(true);
    expect(
      loadEnvironment({
        ...base,
        LOCAL_DATABASE: "false",
        DATABASE_URL:
          "postgresql://app:secret@db.example.com:5432/chalktalk?sslmode=require",
      }).localDatabase,
    ).toBe(false);
    expect(
      loadEnvironment({ ...base, LOCAL_FILE_STORE: "false" }).localFileStore,
    ).toBe(false);
    for (const value of ["FALSE", "1", "yes", "", " true "])
      expect(() => loadEnvironment({ ...base, LOCAL_DATABASE: value })).toThrow(
        "LOCAL_DATABASE must be true or false",
      );
    for (const value of ["FALSE", "0", "no", "", " true "])
      expect(() =>
        loadEnvironment({ ...base, LOCAL_FILE_STORE: value }),
      ).toThrow("LOCAL_FILE_STORE must be true or false");
  });

  it("requires an explicit remote PostgreSQL URL when local database is disabled", () => {
    for (const databaseUrl of [
      undefined,
      "",
      "not-a-url",
      "http://db.example.com/chalktalk",
      "postgresql://localhost/chalktalk",
      "postgresql://app:secret@127.0.0.1/chalktalk",
      "postgresql://app@db.example.com/chalktalk",
      "postgresql://app:secret@db.example.com/",
    ])
      expect(() =>
        loadEnvironment({
          ...base,
          LOCAL_DATABASE: "false",
          DATABASE_URL: databaseUrl,
        }),
      ).toThrow("DATABASE_URL");
  });
  it("requires one TLS-enforcing sslmode for managed database connections", () => {
    const databaseUrl = "postgresql://app:secret@db.example.com/chalktalk";
    for (const suffix of [
      "",
      "?sslmode=disable",
      "?sslmode=allow",
      "?sslmode=prefer",
      "?sslmode=require&sslmode=disable",
      "?sslmode=disable&sslmode=require",
    ])
      expect(() =>
        loadEnvironment({
          ...base,
          LOCAL_DATABASE: "false",
          DATABASE_URL: `${databaseUrl}${suffix}`,
        }),
      ).toThrow("sslmode");

    for (const sslmode of ["require", "verify-ca", "verify-full"])
      expect(
        loadEnvironment({
          ...base,
          LOCAL_DATABASE: "false",
          DATABASE_URL: `${databaseUrl}?sslmode=${sslmode}`,
        }).databaseUrl,
      ).toBe(`${databaseUrl}?sslmode=${sslmode}`);

    expect(
      loadEnvironment({ ...base, DATABASE_URL: databaseUrl }).databaseUrl,
    ).toBe(databaseUrl);
  });
  it("uses SMTP locally and requires explicit Resend credentials in HTTPS mode", () => {
    expect(loadEnvironment(base).email.provider).toBe("smtp");
    expect(() =>
      loadEnvironment({ ...base, EMAIL_PROVIDER: "invalid" }),
    ).toThrow("EMAIL_PROVIDER");
    expect(() =>
      loadEnvironment({ ...base, EMAIL_PROVIDER: "resend" }),
    ).toThrow("RESEND_API_KEY");
    expect(() =>
      loadEnvironment({
        ...base,
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test",
      }),
    ).toThrow("EMAIL_FROM");
    expect(
      loadEnvironment({
        ...base,
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "ChalkTalk <noreply@example.edu>",
      }).email,
    ).toEqual({
      provider: "resend",
      from: "ChalkTalk <noreply@example.edu>",
      resendApiKey: "re_test",
      resendApiBaseUrl: "https://api.resend.com",
    });
    expect(
      loadEnvironment({
        ...base,
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test",
        EMAIL_FROM: "sender@example.edu",
        RESEND_API_BASE_URL: "http://127.0.0.1:4000/",
      }).email,
    ).toMatchObject({ resendApiBaseUrl: "http://127.0.0.1:4000" });
    for (const endpoint of [
      "not-a-url",
      "ftp://example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "https://example.com?x=1",
    ]) {
      expect(() =>
        loadEnvironment({
          ...base,
          EMAIL_PROVIDER: "resend",
          RESEND_API_KEY: "re_test",
          EMAIL_FROM: "sender@example.edu",
          RESEND_API_BASE_URL: endpoint,
        }),
      ).toThrow("RESEND_API_BASE_URL");
    }
  });
  it("disables proxy trust by default and only accepts one explicit hop", () => {
    expect(loadEnvironment(base).trustProxyHops).toBe(0);
    expect(
      loadEnvironment({ ...base, TRUST_PROXY_HOPS: "1" }).trustProxyHops,
    ).toBe(1);
    for (const value of ["2", "true", "-1", "localhost"])
      expect(() =>
        loadEnvironment({ ...base, TRUST_PROXY_HOPS: value }),
      ).toThrow("TRUST_PROXY_HOPS");
  });
  it("parses configured origins and documented rate defaults", () => {
    const environment = loadEnvironment(base);
    expect(environment.frontendOrigins).toEqual(
      new Set(["https://app.example.edu"]),
    );
    expect(environment.rateLimits).toMatchObject({
      verificationPerEmail: 5,
      loginPerEmail: 10,
      resetPerEmail: 5,
      signupPerIp: 100,
      collaborationCreatePerUser: 30,
      collaborationTicketPerUser: 300,
    });
    expect(environment.collaboration.idleEndMinutes).toBe(120);
  });

  it("bounds the live session idle period", () => {
    expect(
      loadEnvironment({ ...base, COLLABORATION_IDLE_END_MINUTES: "45" })
        .collaboration.idleEndMinutes,
    ).toBe(45);
    expect(() =>
      loadEnvironment({ ...base, COLLABORATION_IDLE_END_MINUTES: "0" }),
    ).toThrow("COLLABORATION_IDLE_END_MINUTES");
    expect(() =>
      loadEnvironment({ ...base, COLLABORATION_IDLE_END_MINUTES: "10081" }),
    ).toThrow("one week");
  });

  it("rejects insecure origins and weak credential-hashing secrets", () => {
    expect(() =>
      loadEnvironment({ ...base, FRONTEND_ORIGINS: "http://app.example.edu" }),
    ).toThrow("HTTPS");
    expect(() =>
      loadEnvironment({ ...base, AUTH_TOKEN_SECRET: "too-short" }),
    ).toThrow("32 characters");
  });
});

describe("object storage environment", () => {
  it("requires explicit HTTPS S3 settings and credentials for managed storage", () => {
    const managed = {
      LOCAL_FILE_STORE: "false",
      S3_ENDPOINT: "https://project.storage.supabase.co/storage/v1/s3",
      S3_BUCKET: "course-files",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "server-only-key",
      S3_SECRET_ACCESS_KEY: "server-only-secret",
    };
    expect(loadObjectStorageConfig(managed)).toEqual({
      bucket: "course-files",
      endpoint: managed.S3_ENDPOINT,
      client: {
        endpoint: managed.S3_ENDPOINT,
        region: "us-east-1",
        forcePathStyle: true,
        credentials: {
          accessKeyId: "server-only-key",
          secretAccessKey: "server-only-secret",
        },
      },
    });
    for (const missing of [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ] as const)
      expect(() =>
        loadObjectStorageConfig({ ...managed, [missing]: undefined }),
      ).toThrow(missing);
    for (const endpoint of [
      "http://project.storage.supabase.co/storage/v1/s3",
      "https://localhost:8333",
      "https://user:pass@project.storage.supabase.co/storage/v1/s3",
      "not-a-url",
    ])
      expect(() =>
        loadObjectStorageConfig({ ...managed, S3_ENDPOINT: endpoint }),
      ).toThrow("S3_ENDPOINT");
  });
  it("uses the SDK credential chain for managed S3 without a custom endpoint", () => {
    expect(
      loadObjectStorageConfig({
        S3_BUCKET: "school-files",
        S3_REGION: "us-west-2",
      }),
    ).toEqual({
      bucket: "school-files",
      endpoint: undefined,
      client: { region: "us-west-2" },
    });
  });

  it("uses explicit credentials and path-style addressing for local SeaweedFS", () => {
    expect(
      loadObjectStorageConfig({
        S3_BUCKET: "local-files",
        S3_REGION: "us-east-1",
        S3_ENDPOINT: "http://127.0.0.1:8333",
        S3_ACCESS_KEY_ID: "local",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toEqual({
      bucket: "local-files",
      endpoint: "http://127.0.0.1:8333",
      client: {
        region: "us-east-1",
        endpoint: "http://127.0.0.1:8333",
        forcePathStyle: true,
        credentials: { accessKeyId: "local", secretAccessKey: "secret" },
      },
    });
  });

  it("rejects incomplete explicit credentials", () => {
    expect(() =>
      loadObjectStorageConfig({ S3_ACCESS_KEY_ID: "local" }),
    ).toThrow("must be set together");
  });

  it("requires an explicit bucket and region for managed AWS", () => {
    expect(() => loadObjectStorageConfig({})).toThrow(
      "S3_BUCKET and S3_REGION",
    );
  });
});

describe("observability environment", () => {
  it("fails closed if enabled without a separate metrics token", () => {
    expect(() =>
      loadEnvironment({ ...base, OBSERVABILITY_ENABLED: "true" }),
    ).toThrow("METRICS_TOKEN");
  });

  it("does not create a metrics endpoint when disabled and accepts a configured spool", () => {
    const environment = loadEnvironment({
      ...base,
      OBSERVABILITY_ENABLED: "true",
      METRICS_TOKEN: "a-separate-operator-token-at-least-32-chars",
      LOG_SPOOL_DIRECTORY: "/var/log/chalktalk",
    });
    expect(environment.observability).toEqual({
      enabled: true,
      metricsToken: "a-separate-operator-token-at-least-32-chars",
      spoolDirectory: "/var/log/chalktalk",
    });
  });
});
