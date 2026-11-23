import { expect, it } from "vitest";
import { loadEnvironment } from "./environment.js";
const secret = "synthetic-secret-with-at-least-32-characters";
for (const NODE_ENV of [undefined, "development"]) {
  it(`requires explicit HTTPS selection outside test fixtures (${NODE_ENV})`, () => {
    expect(() =>
      loadEnvironment({ AUTH_TOKEN_SECRET: secret, NODE_ENV }),
    ).toThrow("EMAIL_PROVIDER");
    expect(() =>
      loadEnvironment({
        AUTH_TOKEN_SECRET: secret,
        NODE_ENV,
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "localhost",
      }),
    ).toThrow("EMAIL_PROVIDER");
  });
}
it("retains the explicit isolated test SMTP seam without an operator fallback", () => {
  expect(
    loadEnvironment({ AUTH_TOKEN_SECRET: secret, NODE_ENV: "test" }).email
      .provider,
  ).toBe("smtp");
});
for (const RESEND_API_BASE_URL of [
  "http://127.0.0.1:9000",
  "https://mail-gateway.example.test",
])
  it(`normal local configuration rejects custom mail origin ${RESEND_API_BASE_URL}`, () => {
    expect(() =>
      loadEnvironment({
        NODE_ENV: "development",
        AUTH_TOKEN_SECRET: secret,
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM: "mail@example.test",
        RESEND_API_KEY: "synthetic",
        RESEND_API_BASE_URL,
      }),
    ).toThrow("RESEND_API_BASE_URL");
  });
