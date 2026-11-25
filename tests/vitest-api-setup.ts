import request from "supertest";

delete process.env.PROD;

// macOS can bind an IPv6 wildcard and an unrelated IPv4-only listener to the
// same port. Supertest's IPv4 URL rewrite can then reach the wrong service.
// Keep the fixture's actual address family; do not change production listeners,
// host settings, dependencies, or the synchronous server-address contract.
const installed = Symbol.for("chalktalk.tests.matchLoopbackFamily");
const prototype = request.Test.prototype as unknown as Record<symbol, boolean>;
if (!prototype[installed]) {
  const serverAddress = request.Test.prototype.serverAddress;
  request.Test.prototype.serverAddress = function (app, path) {
    const result = serverAddress.call(this, app, path);
    if (
      typeof app !== "string" &&
      "address" in app &&
      typeof app.address === "function"
    ) {
      const address = app.address();
      if (address && typeof address === "object" && address.address === "::") {
        const url = new URL(result);
        url.hostname = "[::1]";
        return url.toString();
      }
    }
    return result;
  };
  Object.defineProperty(request.Test.prototype, installed, { value: true });
}
