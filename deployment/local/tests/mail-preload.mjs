import { URL } from "node:url";
// Explicit CI fixture transport only. No operator selector or application import.
// Keep normal provider configuration intact while preventing any real mail handoff.
const ordinaryFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method =
    init?.method ??
    (input instanceof globalThis.Request ? input.method : "GET");
  if (
    url.origin === "https://api.resend.com" &&
    url.pathname === "/emails" &&
    method === "POST"
  ) {
    const signal =
      init?.signal ??
      (input instanceof globalThis.Request ? input.signal : undefined);
    if (signal?.aborted)
      throw new globalThis.DOMException(
        "Fixture delivery aborted",
        "AbortError",
      );
    return globalThis.Response.json({ id: "synthetic-ci-acceptance" });
  }
  return ordinaryFetch(input, init);
};
