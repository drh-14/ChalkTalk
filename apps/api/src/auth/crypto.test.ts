import { describe, expect, it } from "vitest";
import { hashOpaqueToken, isValidPassword, newOpaqueToken } from "./crypto.js";

describe("authentication credentials", () => {
  it("creates unpredictable opaque tokens and hashes them deterministically with a secret", () => {
    const first = newOpaqueToken();
    const second = newOpaqueToken();

    expect(first).not.toBe(second);
    expect(hashOpaqueToken(first, "test-secret")).toStrictEqual(
      hashOpaqueToken(first, "test-secret"),
    );
    expect(hashOpaqueToken(first, "test-secret")).not.toBe(
      hashOpaqueToken(first, "different-secret"),
    );
  });

  it("enforces the documented password length", () => {
    expect(isValidPassword("short")).toBe(false);
    expect(isValidPassword("a".repeat(12))).toBe(true);
    expect(isValidPassword("a".repeat(129))).toBe(false);
  });
});
