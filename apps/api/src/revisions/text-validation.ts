import { AuthError } from "../auth/errors.js";

function textWithin(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum)
    throw new AuthError(422, "validation_failed", `${field} is invalid`);
  return value;
}

export const postTitle = (value: unknown) => textWithin(value, "Title", 200);
export const postBody = (value: unknown) => textWithin(value, "Body", 100000);
export function discussionBody(value: unknown): string {
  const body = postBody(value);
  if (!body.trim())
    throw new AuthError(422, "validation_failed", "Body is invalid");
  return body;
}
