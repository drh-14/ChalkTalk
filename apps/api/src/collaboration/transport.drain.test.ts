import { Hocuspocus } from "@hocuspocus/server";
import { expect, it } from "vitest";
import { createCollaborationTransport } from "./transport.js";
it("transport cleanup is reentrant after confirmed document destruction", async () => {
  const transport = createCollaborationTransport({
    hocuspocus: new Hocuspocus(),
    port: 0,
    address: "127.0.0.1",
    maxPayload: 1024,
    admissionTimeoutMs: 1000,
    onAbort: () => {},
    onRequest: async (_req, response) => {
      response.end();
    },
  });
  await transport.listen();
  await transport.destroy();
  await expect(transport.closeTransports()).resolves.toBeUndefined();
  await expect(transport.closeTransports()).resolves.toBeUndefined();
});
