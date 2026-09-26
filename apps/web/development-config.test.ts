// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createViteConfig } from "./vite.config.js";

describe("Vite development configuration", () => {
  it("forwards API requests to the host API by default", () => {
    const configuration = createViteConfig({});

    expect(configuration.server?.proxy).toMatchObject({
      "/api/health": {
        rewrite: expect.any(Function),
        target: "http://localhost:3000",
      },
      "/api": {
        changeOrigin: true,
        target: "http://localhost:3000",
      },
    });
  });

  it("uses the configured internal API target and TLS certificate files", () => {
    const certificatePath = "apps/web/index.html";
    const configuration = createViteConfig({
      VITE_API_PROXY_TARGET: "http://api:3000",
      VITE_TLS_CERT_PATH: certificatePath,
      VITE_TLS_KEY_PATH: certificatePath,
    });

    expect(configuration.server?.proxy).toMatchObject({
      "/api/health": { target: "http://api:3000" },
      "/api": { target: "http://api:3000" },
    });
    expect(configuration.server?.https).toEqual({
      cert: readFileSync(certificatePath),
      key: readFileSync(certificatePath),
    });
  });
});
