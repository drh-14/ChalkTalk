import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Environment } from "../config/environment.js";
import { AuthService, normalizeEmail } from "./service.js";

describe("academic email admission", () => {
  it.each([
    "student,admin@school.edu",
    `${"a".repeat(65)}@school.edu`,
    '"student"@school.edu',
    "studént@school.edu",
    "student\0admin@school.edu",
  ])("rejects malformed local part %j before persistence", async (email) => {
    const query = vi.fn();
    const send = vi.fn();
    const service = new AuthService(
      { query } as unknown as Pool,
      {} as Environment,
      { send },
    );

    await expect(service.requestVerification(email)).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
    });
    expect(query).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves legacy email normalization for login and reset", () => {
    expect(normalizeEmail(" John..Smith@Example.COM ")).toBe(
      "john..smith@example.com",
    );
  });
});
