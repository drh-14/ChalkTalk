import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./environment.js";

const base = {
  AUTH_TOKEN_SECRET: "this-is-a-development-secret-that-is-long-enough",
  FRONTEND_ORIGINS: "https://app.example.edu",
  FRONTEND_BASE_URL: "https://app.example.edu",
  ALLOWED_SCHOOL_DOMAINS: "example.edu,school.example.edu",
};

describe("authentication environment", () => {
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
    });
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
