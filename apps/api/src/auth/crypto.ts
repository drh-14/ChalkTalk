import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-chalktalk_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(token).digest();
}

export function tokensMatch(
  actual: string,
  expectedHash: Buffer,
  secret: string,
): boolean {
  const actualHash = hashOpaqueToken(actual, secret);
  return timingSafeEqual(actualHash, expectedHash);
}

export function isValidPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128
  );
}

export function sessionCookie(
  value: string,
  maxAge = SESSION_MAX_AGE_SECONDS,
): string {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}
