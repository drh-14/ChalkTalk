import { cpSync, createReadStream, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite";

// The package's browser export uses document at import time, which is unavailable
// in the Markdown validation worker. Its default export is DOM-free.
const characterDecoder = createRequire(import.meta.url).resolve(
  "decode-named-character-reference",
);

/** Where the whiteboard loads Excalidraw's fonts from, instead of esm.sh. */
export const EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

/**
 * Serves Excalidraw's fonts from this origin in development and copies them
 * into the build, so the whiteboard makes no third-party requests.
 */
export function excalidrawAssets(
  fonts = join(
    dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")),
    "fonts",
  ),
): Plugin {
  const root = resolve(fonts);
  return {
    name: "chalktalk-excalidraw-assets",
    configureServer(server) {
      server.middlewares.use(
        `${EXCALIDRAW_ASSET_PATH}fonts`,
        (request, response, next) => {
          let file: string;
          try {
            file = resolve(
              root,
              `.${decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname)}`,
            );
          } catch {
            return next();
          }
          if (!file.startsWith(root + sep) || !file.endsWith(".woff2"))
            return next();
          try {
            if (!statSync(file).isFile()) return next();
          } catch {
            return next();
          }
          response.setHeader("Content-Type", "font/woff2");
          response.setHeader("Cache-Control", "public, max-age=86400");
          createReadStream(file).pipe(response);
        },
      );
    },
    writeBundle(options) {
      if (options.dir)
        cpSync(root, join(options.dir, "excalidraw-assets", "fonts"), {
          recursive: true,
        });
    },
  };
}

export function createViteConfig(
  environment: Record<string, string | undefined>,
): UserConfig {
  const key = environment.VITE_TLS_KEY_PATH;
  const cert = environment.VITE_TLS_CERT_PATH;
  return {
    plugins: [react(), excalidrawAssets()],
    resolve: {
      alias: [
        {
          find: "decode-named-character-reference",
          replacement: characterDecoder,
        },
      ],
    },
    server: {
      https:
        key && cert
          ? { key: readFileSync(key), cert: readFileSync(cert) }
          : undefined,
      proxy: {
        "/api/health": {
          target: environment.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
          changeOrigin: true,
          rewrite: () => "/health",
        },
        "/api": {
          target: environment.VITE_API_PROXY_TARGET ?? "http://localhost:3000",
          changeOrigin: true,
        },
        // Live code sessions; the browser Origin header is forwarded unchanged.
        "/collaboration": {
          target:
            environment.VITE_COLLABORATION_PROXY_TARGET ??
            "ws://localhost:3100",
          ws: true,
        },
      },
      watch:
        environment.VITE_USE_POLLING === "true"
          ? { usePolling: true }
          : undefined,
    },
  };
}

export default defineConfig(({ mode }) =>
  createViteConfig(loadEnv(mode, process.cwd(), "")),
);
