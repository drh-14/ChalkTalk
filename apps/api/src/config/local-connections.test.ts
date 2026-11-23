import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateLocalConnection } from "./local-connections.js";
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../../../deployment/local/tests/connection-fixtures.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<{
  field: "DATABASE_URL" | "S3_ENDPOINT";
  value: string;
  valid: boolean;
}>;
describe("supported local connection grammar", () => {
  for (const fixture of fixtures)
    it(`${fixture.field} ${fixture.valid ? "accepts" : "rejects"} ${fixture.value}`, () => {
      if (fixture.valid)
        expect(() =>
          validateLocalConnection(fixture.field, fixture.value),
        ).not.toThrow();
      else {
        expect(() =>
          validateLocalConnection(fixture.field, fixture.value),
        ).toThrow(fixture.field);
        try {
          validateLocalConnection(fixture.field, fixture.value);
        } catch (error) {
          expect(String(error)).not.toContain(fixture.value);
        }
      }
    });
});

import { loadEnvironment } from "./environment.js";
const literals = JSON.parse(
  readFileSync(
    new URL(
      "../../../../deployment/local/tests/literal-fixtures.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<{ value: string; valid: boolean }>;
for (const fixture of literals)
  it(`application literal credential acceptance ${JSON.stringify(fixture.value)}`, () => {
    const load = () =>
      loadEnvironment({
        AUTH_TOKEN_SECRET: "synthetic-secret-with-at-least-32-characters",
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM: "mail@example.test",
        RESEND_API_KEY: fixture.value,
      });
    if (fixture.valid) expect(load).not.toThrow();
    else expect(load).toThrow("RESEND_API_KEY");
  });
for (const fixture of JSON.parse(
  readFileSync(
    new URL(
      "../../../../deployment/local/tests/sender-fixtures.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Array<{ value: string; valid: boolean }>)
  it(`application sender acceptance ${fixture.value}`, () => {
    const load = () =>
      loadEnvironment({
        AUTH_TOKEN_SECRET: "synthetic-secret-with-at-least-32-characters",
        EMAIL_PROVIDER: "resend",
        EMAIL_FROM: fixture.value,
        RESEND_API_KEY: "synthetic",
      });
    if (fixture.valid) expect(load).not.toThrow();
    else expect(load).toThrow("EMAIL_FROM");
  });
