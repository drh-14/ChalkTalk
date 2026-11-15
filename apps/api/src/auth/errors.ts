/** One invalid field, in the documented `ErrorDetail` shape. */
export type ErrorDetail = {
  location: "path" | "query" | "header" | "body";
  path: string;
  code: string;
  message: string;
};

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}
