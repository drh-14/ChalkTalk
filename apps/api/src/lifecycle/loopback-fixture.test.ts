import { createServer } from "node:http";
import { once } from "node:events";
import request from "supertest";
import { expect, it } from "vitest";
it("targets the same address family as the ephemeral HTTP fixture", async () => {
  const server = createServer((incoming, response) =>
    response.end(incoming.socket.localAddress),
  );
  const result = request(server).get("/");
  const address = server.address();
  const expected =
    address && typeof address === "object" && address.address === "::"
      ? "::1"
      : "127.0.0.1";
  expect((await result).text).toBe(expected);
});
it.runIf(process.platform === "darwin")(
  "never reaches an unrelated IPv4 listener sharing the wildcard fixture's port",
  async () => {
    const other = createServer((_request, response) =>
      response.end("unrelated service"),
    );
    other.listen(0, "127.0.0.1");
    await once(other, "listening");
    const server = createServer((_request, response) =>
      response.end("intended fixture"),
    );
    const port = (other.address() as { port: number }).port;
    server.listen(port);
    await once(server, "listening");
    try {
      expect((await request(server).get("/")).text).toBe("intended fixture");
    } finally {
      await Promise.all(
        [other, server].map(
          (value) => new Promise<void>((done) => value.close(() => done())),
        ),
      );
    }
  },
);
