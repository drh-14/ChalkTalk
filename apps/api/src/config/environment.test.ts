import { describe, expect, it } from "vitest";
import { loadEnvironment, loadObjectStorageConfig } from "./environment.js";

const base = {
  AUTH_TOKEN_SECRET: "this-is-a-development-secret-that-is-long-enough",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
  ALLOWED_SCHOOL_DOMAINS: "example.edu,school.example.edu",
};

describe("authentication environment", () => {
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
    });
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
  it("parses configured origins, domains, and documented rate defaults", () => {
    const environment = loadEnvironment(base);
    expect(environment.frontendOrigins).toEqual(
      new Set(["https://app.example.edu"]),
    );
    expect(environment.allowedSchoolDomains).toEqual(
      new Set(["example.edu", "school.example.edu"]),
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
