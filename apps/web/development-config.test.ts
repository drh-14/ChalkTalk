// @vitest-environment node

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import {
  createViteConfig,
  EXCALIDRAW_ASSET_PATH,
  excalidrawAssets,
} from "./vite.config.js";

describe("Vite development configuration", () => {
  it("resolves the character-reference decoder to a worker-safe implementation", async () => {
    const configuration = createViteConfig({});
    const aliases = configuration.resolve?.alias;
    expect(Array.isArray(aliases)).toBe(true);
    const decoderPath = (
      aliases as { find: string; replacement: string }[]
    ).find(
      (alias) => alias.find === "decode-named-character-reference",
    )?.replacement;
    expect(decoderPath).toBeTruthy();
    const decoder = await import(pathToFileURL(decoderPath!).href);
    expect(decoder.decodeNamedCharacterReference("amp")).toBe("&");
    expect(decoder.decodeNamedCharacterReference("not-a-reference")).toBe(
      false,
    );
  });

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

  it("proxies live code session WebSockets without rewriting the browser origin", () => {
    const local = createViteConfig({}).server?.proxy as Record<
      string,
      { target: string; ws?: boolean; changeOrigin?: boolean }
    >;
    expect(local["/collaboration"]).toEqual({
      target: "ws://localhost:3100",
      ws: true,
    });
    const compose = createViteConfig({
      VITE_COLLABORATION_PROXY_TARGET: "ws://collaboration:3100",
    }).server?.proxy as Record<string, { target: string }>;
    expect(compose["/collaboration"]!.target).toBe("ws://collaboration:3100");
  });

  it("proxies authenticated Thread WebSockets through the API origin", () => {
    const proxy = createViteConfig({}).server?.proxy as Record<
      string,
      { ws?: boolean; changeOrigin?: boolean }
    >;
    expect(proxy["/api"]).toMatchObject({ ws: true, changeOrigin: true });
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

  it("serves Excalidraw fonts from this origin and copies them into the build", async () => {
    const plugin = excalidrawAssets();
    expect(createViteConfig({}).plugins?.flat()).toContainEqual(
      expect.objectContaining({ name: plugin.name }),
    );
    const server = await createServer({
      configFile: false,
      root: mkdtempSync(join(tmpdir(), "chalktalk-vite-")),
      logLevel: "silent",
      plugins: [plugin],
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    try {
      const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
      const family = "Excalifont";
      const name = readdirSync(
        join(
          import.meta.dirname,
          "../../node_modules/@excalidraw/excalidraw/dist/prod/fonts",
          family,
        ),
      )[0]!;
      const font = await fetch(
        `${origin}${EXCALIDRAW_ASSET_PATH}fonts/${family}/${name}`,
      );
      expect(font.status).toBe(200);
      expect(font.headers.get("content-type")).toBe("font/woff2");
      const escape = await fetch(
        `${origin}${EXCALIDRAW_ASSET_PATH}fonts/..%2F..%2Fpackage.json`,
      );
      expect(escape.headers.get("content-type")).not.toBe("font/woff2");
    } finally {
      await server.close();
    }

    const output = mkdtempSync(join(tmpdir(), "chalktalk-build-"));
    try {
      (plugin.writeBundle as (options: { dir: string }) => void)({
        dir: output,
      });
      expect(readdirSync(join(output, "excalidraw-assets", "fonts"))).toContain(
        "Excalifont",
      );
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
